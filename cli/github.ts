import { createHash } from 'node:crypto';
import { isArtifact, maxFileBytes } from './reader.ts';
import type { ArtifactFile, PullRequestInput, ReviewFile } from './workspace.model.ts';

export interface GitHubOptions {
  /** The GraphQL endpoint, https://api.github.com/graphql on github.com. */
  graphqlUrl: string;
  token: string;
  /** owner/name */
  repository: string;
  /** Only pull requests that target this branch are read. */
  branch: string;
  /** The openspec folder, relative to the repository root. */
  folder: string;
  fetch?: typeof fetch;
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}
interface ChangedFile {
  path: string;
  changeType: string;
}
interface Thread {
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  diffSide: string;
  subjectType: string;
  comments: {
    totalCount: number;
    nodes: { author: { login: string } | null; body: string; createdAt: string; url: string }[];
  };
}
interface Node {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  author: { login: string } | null;
  headRefName: string;
  headRefOid: string;
  updatedAt: string;
  files: Page<ChangedFile> | null;
  reviewThreads: Page<Thread>;
}
interface Entry {
  name: string;
  type: string;
  mode: number;
  oid: string;
  size: number;
}
type Query = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

const maxPullRequests = 200;
// Aliased objects per request.
const batch = 50;
// Git's mode of a symbolic link, as the number it is and as GitHub would print it.
const symbolicLinks = [0o120000, 120000];
const permissions =
  ' The workflow needs the permissions "contents: read" and "pull-requests: read".';

const files =
  'files(first: 100, after: $files) { pageInfo { hasNextPage endCursor } nodes { path changeType } }';
const threads = `reviewThreads(first: 50, after: $threads) {
  pageInfo { hasNextPage endCursor }
  nodes {
    isResolved isOutdated path line diffSide subjectType
    comments(first: 30) { totalCount nodes { author { login } body createdAt url } }
  }
}`;
const list = `query($owner: String!, $name: String!, $branch: String!, $after: String, $files: String, $threads: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: $branch, first: 25, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft isCrossRepository headRefName headRefOid updatedAt
        author { login }
        ${files}
        ${threads}
      }
    }
  }
}`;
// The next page of one connection of one pull request.
const more = (key: 'files' | 'threads') =>
  `query($owner: String!, $name: String!, $number: Int!, $${key}: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${key === 'files' ? files : threads} } }
}`;

function client(options: GitHubOptions): Query {
  const request = options.fetch ?? fetch;
  return async (query, variables) => {
    let response: Response;
    try {
      response = await request(options.graphqlUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + options.token,
          'Content-Type': 'application/json',
          'User-Agent': 'openspec-desk',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new Error('GitHub could not be reached: ' + (error as Error).message);
    }
    const body = (await response.json().catch(() => ({}))) as {
      data?: unknown;
      message?: string;
      errors?: { type?: string; message: string }[];
    };
    if (response.ok && !body.errors?.length) {
      if (body.data) return body.data as never;
      throw new Error('GitHub answered with something other than GraphQL data.');
    }
    const problem = body.errors?.[0]?.message ?? body.message ?? '';
    const forbidden =
      [401, 403].includes(response.status) ||
      body.errors?.some((error) => error.type === 'FORBIDDEN');
    throw new Error(
      `GitHub answered${response.ok ? '' : ' ' + response.status}: ${problem || response.statusText}`.replace(
        /[.:\s]*$/,
        '.',
      ) + (forbidden && !/rate limit/i.test(problem) ? permissions : ''),
    );
  };
}

/** The change folders, relative to the openspec folder, that a pull request adds to or modifies. */
function changeFolders(changed: ChangedFile[], prefix: string): string[] {
  const folders = new Set<string>();
  for (const file of changed) {
    if (file.changeType === 'DELETED' || !file.path.startsWith(prefix + 'changes/')) continue;
    const parts = file.path.slice(prefix.length).split('/');
    const depth = parts[1] === 'archive' ? 3 : 2;
    if (parts.length > depth) folders.add(parts.slice(0, depth).join('/'));
  }
  return [...folders];
}

/** The imported documents that a pull request changes, with their diffs in its Files changed view. */
function reviewFiles(
  url: string,
  changed: ChangedFile[],
  files: ArtifactFile[],
  prefix: string,
): ReviewFile[] {
  const types = new Map(changed.map((file) => [file.path, file.changeType]));
  return files.flatMap((file) => {
    const path = prefix + file.path;
    const type = types.get(path);
    if (!type) return [];
    // GitHub names a file's diff after the SHA-256 of its path in the repository.
    const anchor = createHash('sha256').update(path, 'utf8').digest('hex');
    return [{ path: file.path, url: url + '/files#diff-' + anchor, added: type === 'ADDED' }];
  });
}

/**
 * Reads the open pull requests that target a branch: the documents of the changes each one adds
 * to or modifies, at its head commit, and the review threads on them.
 */
export async function readPullRequests(
  options: GitHubOptions,
): Promise<{ pullRequests: PullRequestInput[]; warnings: string[] }> {
  const query = client(options);
  const [owner, name] = options.repository.split('/');
  const prefix = options.folder ? options.folder + '/' : '';
  const warnings: string[] = [];

  const nodes: Node[] = [];
  let after: string | null = null;
  let total = 0;
  let listed = 0;
  do {
    const page: Page<Node> & { totalCount: number } = (
      await query<{ repository: { pullRequests: Page<Node> & { totalCount: number } } }>(list, {
        owner,
        name,
        branch: options.branch,
        after,
      })
    ).repository.pullRequests;
    total = page.totalCount;
    listed += page.nodes.length;
    // The list is ordered by update time, so an update between two requests can repeat an entry.
    nodes.push(...page.nodes.filter((node) => nodes.every((seen) => seen.number !== node.number)));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after && listed < maxPullRequests);
  if (total > listed)
    warnings.push(
      `Only the ${listed} most recently updated open pull requests were read; ${total - listed} were not.`,
    );
  const forks = nodes.filter((node) => node.isCrossRepository).length;
  if (forks)
    warnings.push(
      forks === 1
        ? '1 pull request from a fork was skipped.'
        : forks + ' pull requests from forks were skipped.',
    );

  /** The remaining pages of a connection of one pull request. */
  async function rest<T>(number: number, key: 'files' | 'threads', first: Page<T>): Promise<T[]> {
    const items = [...first.nodes];
    let page = first;
    while (page.pageInfo.hasNextPage) {
      const result = await query<{
        repository: { pullRequest: { files?: Page<T>; reviewThreads?: Page<T> } };
      }>(more(key), {
        owner,
        name,
        number,
        [key]: page.pageInfo.endCursor,
      });
      page = (result.repository.pullRequest.files ?? result.repository.pullRequest.reviewThreads)!;
      items.push(...page.nodes);
    }
    return items;
  }
  /** Git objects by key, an oid or a `commit:path` expression; several per request. */
  async function objects<T>(by: 'oid' | 'expression', fields: string, keys: string[]) {
    const found = new Map<string, T | null>();
    const unique = [...new Set(keys)];
    for (let start = 0; start < unique.length; start += batch) {
      const part = unique.slice(start, start + batch);
      const type = by === 'oid' ? 'GitObjectID!' : 'String!';
      const result = await query<{ repository: Record<string, T | null> }>(
        `query($owner: String!, $name: String!, ${part.map((_, at) => `$v${at}: ${type}`).join(', ')}) {
  repository(owner: $owner, name: $name) {
    ${part.map((_, at) => `o${at}: object(${by}: $v${at}) { ${fields} }`).join('\n    ')}
  }
}`,
        { owner, name, ...Object.fromEntries(part.map((key, at) => ['v' + at, key])) },
      );
      part.forEach((key, at) => found.set(key, result.repository['o' + at]));
    }
    return found;
  }

  const candidates: {
    node: Node;
    changed: ChangedFile[];
    folders: string[];
    threads: Thread[];
    files: ArtifactFile[];
  }[] = [];
  for (const node of nodes) {
    if (node.isCrossRepository || !node.files) continue;
    const changed = await rest(node.number, 'files', node.files);
    const folders = changeFolders(changed, prefix);
    if (folders.length)
      candidates.push({
        node,
        changed,
        folders,
        threads: await rest(node.number, 'threads', node.reviewThreads),
        files: [],
      });
  }

  // Folders are listed level by level, for all pull requests at once.
  const blobs: { candidate: (typeof candidates)[number]; path: string; oid: string }[] = [];
  let pending = candidates.flatMap((candidate) =>
    candidate.folders.map((folder) => ({
      candidate,
      directory: folder,
      depth: folder.split('/').length,
    })),
  );
  const expression = (item: (typeof pending)[number]) =>
    item.candidate.node.headRefOid + ':' + prefix + item.directory;
  while (pending.length) {
    const trees = await objects<{ entries?: Entry[] }>(
      'expression',
      '... on Tree { entries { name type mode oid size } }',
      pending.map(expression),
    );
    const next: typeof pending = [];
    for (const item of pending) {
      const where = ' in pull request #' + item.candidate.node.number;
      for (const entry of trees.get(expression(item))?.entries ?? []) {
        const path = item.directory + '/' + entry.name;
        if (symbolicLinks.includes(entry.mode))
          warnings.push(`Skipped symbolic link${where}: ${path}`);
        else if (entry.name.startsWith('.') && entry.name !== '.openspec.yaml') continue;
        else if (entry.type === 'tree') {
          if (item.depth < 20) next.push({ ...item, directory: path, depth: item.depth + 1 });
          else warnings.push(`Skipped a folder below the supported depth (20)${where}: ${path}`);
        } else if (entry.type !== 'blob' || !isArtifact(entry.name)) continue;
        else if (entry.size > maxFileBytes)
          warnings.push(`Skipped a document larger than 2 MB${where}: ${path}`);
        else blobs.push({ candidate: item.candidate, path, oid: entry.oid });
      }
    }
    pending = next;
  }

  const contents = await objects<{
    text?: string | null;
    isTruncated?: boolean;
    isBinary?: boolean;
  }>(
    'oid',
    '... on Blob { text isTruncated isBinary }',
    blobs.map((blob) => blob.oid),
  );
  for (const { candidate, path, oid } of blobs) {
    const blob = contents.get(oid);
    if (typeof blob?.text === 'string' && !blob.isTruncated && !blob.isBinary)
      candidate.files.push({ path, content: blob.text, modified: null });
    else
      warnings.push(
        `Skipped a document GitHub could not return as text in pull request #${candidate.node.number}: ${path}`,
      );
  }

  return {
    warnings,
    pullRequests: candidates.map(({ node, changed, folders, threads, files }) => ({
      number: node.number,
      title: node.title,
      url: node.url,
      author: node.author?.login ?? 'ghost',
      draft: node.isDraft,
      branch: node.headRefName,
      commit: node.headRefOid,
      updatedAt: node.updatedAt,
      files,
      threads: threads
        .filter(
          (thread) =>
            thread.comments.nodes.length &&
            folders.some((folder) => thread.path.startsWith(prefix + folder + '/')),
        )
        .map((thread) => ({
          url: thread.comments.nodes[0].url,
          path: thread.path.slice(prefix.length),
          // Only a line on the new side of a current diff is a line of the document at the head.
          line:
            thread.subjectType === 'LINE' && thread.diffSide === 'RIGHT' && !thread.isOutdated
              ? thread.line
              : null,
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
          comments: thread.comments.nodes.map((comment) => ({
            author: comment.author?.login ?? 'ghost',
            body: comment.body,
            createdAt: comment.createdAt,
            url: comment.url,
          })),
          omitted: thread.comments.totalCount - thread.comments.nodes.length,
        })),
      reviewFiles: reviewFiles(node.url, changed, files, prefix),
    })),
  };
}
