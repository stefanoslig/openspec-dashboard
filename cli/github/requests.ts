// The requests the reader sends GitHub: the list of open pull requests, the remaining pages of one
// of their connections, and git objects in batches.

import type { GitHubApi, Page, PullRequestNode } from './api.ts';

const maxPullRequests = 200;
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

export interface PullRequestListing {
  nodes: PullRequestNode[];
  /** Nodes received, repeats included; the cap counts these. */
  listed: number;
  /** Open pull requests on the branch, listed or not. */
  total: number;
}

/** One page of the list, with the count of all the open pull requests on the branch. */
interface ListedPage extends Page<PullRequestNode> {
  totalCount: number;
}

/** The open pull requests that target the branch, newest updated first, pages of 25, at most 200. */
export async function listOpenPullRequests(
  api: GitHubApi,
  branch: string,
): Promise<PullRequestListing> {
  const nodes: PullRequestNode[] = [];
  let after: string | null = null;
  let total: number;
  let listed = 0;
  do {
    const page: ListedPage = (
      await api.query<{ repository: { pullRequests: ListedPage } }>(list, {
        owner: api.owner,
        name: api.name,
        branch,
        after,
      })
    ).repository.pullRequests;
    total = page.totalCount;
    listed += page.nodes.length;
    // The list is ordered by update time, so an update between two requests can repeat an entry.
    nodes.push(...page.nodes.filter((node) => nodes.every((seen) => seen.number !== node.number)));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after && listed < maxPullRequests);
  return { nodes, listed, total };
}

// The next page of one connection of one pull request.
const more = (key: 'files' | 'threads') =>
  `query($owner: String!, $name: String!, $number: Int!, $${key}: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${key === 'files' ? files : threads} } }
}`;

/** One paged connection of one pull request: its changed files or its review threads. */
export interface Connection {
  number: number;
  key: 'files' | 'threads';
}

/** The remaining pages of a connection of one pull request. */
export async function remainingPages<T>(
  api: GitHubApi,
  connection: Connection,
  first: Page<T>,
): Promise<T[]> {
  const items = [...first.nodes];
  let page = first;
  while (page.pageInfo.hasNextPage) {
    const { repository } = await api.query<{
      repository: { pullRequest: { files?: Page<T>; reviewThreads?: Page<T> } };
    }>(more(connection.key), {
      owner: api.owner,
      name: api.name,
      number: connection.number,
      [connection.key]: page.pageInfo.endCursor,
    });
    page = (repository.pullRequest.files ?? repository.pullRequest.reviewThreads)!;
    items.push(...page.nodes);
  }
  return items;
}

// Aliased objects per request.
const objectsPerRequest = 50;

/** How git objects are addressed, and which of their fields to read. */
export interface ObjectLookup {
  by: 'oid' | 'expression';
  fields: string;
}

/** The query for `count` objects, aliased `o0..` and addressed by the variables `v0..`. */
function objectsQuery({ by, fields }: ObjectLookup, count: number): string {
  const type = by === 'oid' ? 'GitObjectID!' : 'String!';
  const slots = Array.from({ length: count }, (_, at) => at);
  return `query($owner: String!, $name: String!, ${slots.map((at) => `$v${at}: ${type}`).join(', ')}) {
  repository(owner: $owner, name: $name) {
    ${slots.map((at) => `o${at}: object(${by}: $v${at}) { ${fields} }`).join('\n    ')}
  }
}`;
}

/** Git objects by key, an oid or a `commit:path` expression; several per request. */
export async function gitObjects<T>(
  api: GitHubApi,
  lookup: ObjectLookup,
  keys: string[],
): Promise<Map<string, T | null>> {
  const found = new Map<string, T | null>();
  const unique = [...new Set(keys)];
  for (let start = 0; start < unique.length; start += objectsPerRequest) {
    const part = unique.slice(start, start + objectsPerRequest);
    const { repository } = await api.query<{ repository: Record<string, T | null> }>(
      objectsQuery(lookup, part.length),
      {
        owner: api.owner,
        name: api.name,
        ...Object.fromEntries(part.map((key, at) => ['v' + at, key])),
      },
    );
    part.forEach((key, at) => found.set(key, repository['o' + at]));
  }
  return found;
}
