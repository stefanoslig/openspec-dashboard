import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readPullRequests } from './pull-requests.ts';

type Json = Record<string, unknown>;
interface Fake {
  /** Pull request nodes in the order GitHub lists them. */
  pulls: Json[];
  /** Pages after the first, by pull request number. */
  files?: Record<number, Json[][]>;
  threads?: Record<number, Json[][]>;
  /** Entries by `commit:path`. */
  trees?: Record<string, Json[]>;
  blobs?: Record<string, Json>;
}

const page = (nodes: Json[], more = false) => ({
  pageInfo: { hasNextPage: more, endCursor: more ? '0' : null },
  nodes,
});
const changed = (path: string, changeType = 'ADDED') => ({ path, changeType });
const pull = (number: number, files: Json[], extra: Json = {}) => ({
  number,
  title: 'Pull request ' + number,
  url: 'https://github.example/acme/roadmap/pull/' + number,
  isDraft: false,
  isCrossRepository: false,
  author: { login: 'mara' },
  headRefName: 'branch-' + number,
  headRefOid: 'sha' + number,
  updatedAt: '2026-10-01T10:00:00Z',
  files: page(files),
  reviewThreads: page([]),
  ...extra,
});
const comment = (id: number, login: string | null = 'ivo') => ({
  author: login && { login },
  body: 'Comment ' + id,
  createdAt: '2026-10-02T08:00:00Z',
  url: 'https://github.example/acme/roadmap/pull/7#discussion_r' + id,
});
const thread = (path: string, comments: Json[], extra: Json = {}) => ({
  isResolved: false,
  isOutdated: false,
  path,
  line: 5,
  diffSide: 'RIGHT',
  subjectType: 'LINE',
  comments: { totalCount: comments.length, nodes: comments },
  ...extra,
});
const blob = (name: string, oid: string, extra: Json = {}) => ({
  name,
  type: 'blob',
  mode: 0o100644,
  oid,
  size: 100,
  ...extra,
});
const tree = (name: string) => ({ name, type: 'tree', mode: 0o040000, oid: 'tree', size: 0 });
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Answers the reader's queries the way the GraphQL API shapes its data. */
function github(fake: Fake) {
  const requests: { url: string; headers: Json; query: string; variables: Json }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init!.body));
    requests.push({ url: String(url), headers: init!.headers as Json, query, variables });
    const repository: Json = {};
    if (query.includes('pullRequests(')) {
      const start = Number(variables.after ?? 0);
      const more = start + 25 < fake.pulls.length;
      repository.pullRequests = {
        totalCount: fake.pulls.length,
        pageInfo: { hasNextPage: more, endCursor: more ? String(start + 25) : null },
        nodes: fake.pulls.slice(start, start + 25),
      };
    } else if (query.includes('pullRequest(number')) {
      const key = 'files' in variables ? 'files' : 'threads';
      const pages = fake[key]![variables.number];
      const at = Number(variables[key]);
      repository.pullRequest = {
        [key === 'files' ? 'files' : 'reviewThreads']: {
          pageInfo: { hasNextPage: at + 1 < pages.length, endCursor: String(at + 1) },
          nodes: pages[at],
        },
      };
    } else
      for (const [key, value] of Object.entries(variables as Record<string, string>)) {
        if (!/^v\d+$/.test(key)) continue;
        const entries = fake.trees?.[value];
        repository['o' + key.slice(1)] = query.includes('on Tree')
          ? entries
            ? { entries }
            : null
          : (fake.blobs?.[value] ?? null);
      }
    return new Response(JSON.stringify({ data: { repository } }));
  };
  return { fetch, requests };
}
const options = {
  graphqlUrl: 'https://api.github.example/graphql',
  token: 't0ken',
  repository: 'acme/roadmap',
  branch: 'main',
  folder: 'docs/openspec',
};

test('reads the changes a pull request adds to or modifies, at its head commit', async () => {
  const delta = 'docs/openspec/changes/add-x/specs/area/spec.md';
  const { fetch, requests } = github({
    pulls: [
      pull(
        7,
        [
          changed('docs/openspec/changes/add-x/proposal.md'),
          changed('docs/openspec/changes/archive/2026-10-03-done/tasks.md', 'RENAMED'),
          changed('docs/openspec/changes/gone/proposal.md', 'DELETED'),
          changed('docs/openspec/changes/archive/loose.md'),
          changed('docs/openspec/specs/area/spec.md', 'MODIFIED'),
          changed('openspec/changes/elsewhere/proposal.md'),
          changed('src/app.ts', 'MODIFIED'),
        ],
        {
          isDraft: true,
          author: null,
          reviewThreads: page([
            thread(delta, [comment(1), comment(2, null)], {
              comments: { totalCount: 5, nodes: [comment(1), comment(2, null)] },
            }),
            thread(delta, [comment(3)], { isOutdated: true, isResolved: true, line: null }),
            thread(delta, [comment(4)], { diffSide: 'LEFT' }),
            thread('docs/openspec/changes/add-x/proposal.md', [comment(5)], {
              subjectType: 'FILE',
              line: null,
            }),
            thread('src/app.ts', [comment(6)]),
            thread('docs/openspec/changes/gone/proposal.md', [comment(7)]),
            thread(delta, []),
          ]),
        },
      ),
      pull(8, [changed('docs/openspec/changes/from-a-fork/proposal.md')], {
        isCrossRepository: true,
      }),
      pull(9, [changed('src/app.ts', 'MODIFIED')]),
    ],
    trees: {
      'sha7:docs/openspec/changes/add-x': [
        blob('.hidden.md', 'hidden'),
        blob('.openspec.yaml', 'metadata'),
        blob('big.md', 'big', { size: 2_000_001 }),
        blob('link.md', 'link', { mode: 0o120000 }),
        blob('logo.png', 'logo'),
        blob('proposal.md', 'proposal'),
        tree('specs'),
        tree('.cache'),
      ],
      'sha7:docs/openspec/changes/add-x/specs': [tree('area')],
      'sha7:docs/openspec/changes/add-x/specs/area': [blob('spec.md', 'spec')],
      'sha7:docs/openspec/changes/archive/2026-10-03-done': [
        blob('binary.md', 'binary'),
        blob('tasks.md', 'truncated'),
      ],
    },
    blobs: {
      metadata: { text: 'schema: spec-driven', isTruncated: false, isBinary: false },
      proposal: { text: '# Add X', isTruncated: false, isBinary: false },
      spec: { text: '## ADDED Requirements', isTruncated: false, isBinary: false },
      truncated: { text: '- [ ] 1', isTruncated: true, isBinary: false },
      binary: { text: null, isTruncated: false, isBinary: true },
    },
  });
  const { pullRequests, warnings } = await readPullRequests({ ...options, fetch });

  const [first, ...trees] = requests;
  assert.equal(first.url, options.graphqlUrl);
  assert.equal(first.headers['Authorization'], 'Bearer t0ken');
  assert.match(first.query, /pullRequests\(states: OPEN, baseRefName: \$branch,/);
  assert.deepEqual(first.variables, {
    owner: 'acme',
    name: 'roadmap',
    branch: 'main',
    after: null,
  });
  // Three levels of folders and one request for the documents; none for the fork or the code.
  assert.equal(trees.length, 4);
  assert.ok(requests.every((request) => !JSON.stringify(request.variables).includes('sha8')));

  assert.deepEqual(pullRequests.length, 1);
  const [{ files, threads, reviewFiles, ...details }] = pullRequests;
  assert.deepEqual(details, {
    number: 7,
    title: 'Pull request 7',
    url: 'https://github.example/acme/roadmap/pull/7',
    author: 'ghost',
    draft: true,
    branch: 'branch-7',
    commit: 'sha7',
    updatedAt: '2026-10-01T10:00:00Z',
  });
  assert.deepEqual(files, [
    { path: 'changes/add-x/.openspec.yaml', content: 'schema: spec-driven', modified: null },
    { path: 'changes/add-x/proposal.md', content: '# Add X', modified: null },
    { path: 'changes/add-x/specs/area/spec.md', content: '## ADDED Requirements', modified: null },
  ]);
  // The delta spec is not part of the diff and the renamed tasks were not read.
  assert.deepEqual(reviewFiles, [
    {
      path: 'changes/add-x/proposal.md',
      url:
        'https://github.example/acme/roadmap/pull/7/files#diff-' +
        sha256('docs/openspec/changes/add-x/proposal.md'),
      added: true,
    },
  ]);
  assert.deepEqual(warnings, [
    '1 pull request from a fork was skipped.',
    'Skipped a document larger than 2 MB in pull request #7: changes/add-x/big.md',
    'Skipped symbolic link in pull request #7: changes/add-x/link.md',
    'Skipped a document GitHub could not return as text in pull request #7: changes/archive/2026-10-03-done/binary.md',
    'Skipped a document GitHub could not return as text in pull request #7: changes/archive/2026-10-03-done/tasks.md',
  ]);
  assert.deepEqual(
    threads.map((item) => [item.path, item.line, item.resolved, item.outdated, item.omitted]),
    [
      ['changes/add-x/specs/area/spec.md', 5, false, false, 3],
      ['changes/add-x/specs/area/spec.md', null, true, true, 0],
      ['changes/add-x/specs/area/spec.md', null, false, false, 0],
      ['changes/add-x/proposal.md', null, false, false, 0],
    ],
  );
  assert.equal(threads[0].url, 'https://github.example/acme/roadmap/pull/7#discussion_r1');
  assert.deepEqual(threads[0].comments, [
    {
      author: 'ivo',
      body: 'Comment 1',
      createdAt: '2026-10-02T08:00:00Z',
      url: 'https://github.example/acme/roadmap/pull/7#discussion_r1',
    },
    {
      author: 'ghost',
      body: 'Comment 2',
      createdAt: '2026-10-02T08:00:00Z',
      url: 'https://github.example/acme/roadmap/pull/7#discussion_r2',
    },
  ]);
});

test('follows the pages of pull requests, files and threads, up to 200 pull requests', async () => {
  const proposal = 'openspec/changes/late/proposal.md';
  const pulls = Array.from({ length: 230 }, (_, at) => pull(at + 1, [changed('src/a.ts')]));
  pulls[0] = pull(1, [changed('src/a.ts')], {
    files: page([changed('src/a.ts')], true),
    reviewThreads: page([thread(proposal, [comment(1)])], true),
  });
  pulls[229] = pull(230, [changed('openspec/changes/never-read/proposal.md')]);
  const { fetch, requests } = github({
    pulls,
    files: { 1: [[changed('src/b.ts')], [changed(proposal)]] },
    threads: { 1: [[thread(proposal, [comment(2)]), thread(proposal, [comment(3)])]] },
    trees: { 'sha1:openspec/changes/late': [blob('proposal.md', 'late')] },
    blobs: { late: { text: 'Late.', isTruncated: false, isBinary: false } },
  });
  const { pullRequests, warnings } = await readPullRequests({
    ...options,
    folder: 'openspec',
    fetch,
  });
  assert.deepEqual(
    requests
      .filter((request) => request.query.includes('pullRequests('))
      .map((r) => r.variables.after),
    [null, '25', '50', '75', '100', '125', '150', '175'],
  );
  assert.deepEqual(warnings, [
    'Only the 200 most recently updated open pull requests were read; 30 were not.',
  ]);
  assert.deepEqual(
    pullRequests.map((item) => [
      item.number,
      item.files.map((file) => file.path),
      item.threads.length,
    ]),
    [[1, ['changes/late/proposal.md'], 3]],
  );
  // An update between two page requests moves a pull request to the front: it is listed again.
  const again = github({
    pulls: [...pulls.slice(0, 30), pulls[0]],
    files: { 1: [[changed('src/b.ts')], [changed(proposal)]] },
    threads: { 1: [[]] },
    trees: { 'sha1:openspec/changes/late': [blob('proposal.md', 'late')] },
    blobs: { late: { text: 'Late.', isTruncated: false, isBinary: false } },
  });
  const twice = await readPullRequests({ ...options, folder: 'openspec', fetch: again.fetch });
  assert.deepEqual([twice.pullRequests.map((item) => item.number), twice.warnings], [[1], []]);
  const followed = requests.filter((request) => request.query.includes('pullRequest(number'));
  assert.deepEqual(
    followed.map((request) => request.variables),
    [
      { owner: 'acme', name: 'roadmap', number: 1, files: '0' },
      { owner: 'acme', name: 'roadmap', number: 1, files: '1' },
      { owner: 'acme', name: 'roadmap', number: 1, threads: '0' },
    ],
  );
});

test('links the documents a pull request changes to their diffs, without more requests', async () => {
  const change = 'docs/openspec/changes/add-roles/';
  const { fetch, requests } = github({
    pulls: [
      pull(5, [], {
        files: page(
          [
            changed(change + 'proposal.md'),
            changed('src/app.ts', 'MODIFIED'),
            changed(change + 'old.md', 'DELETED'),
          ],
          true,
        ),
      }),
    ],
    files: {
      5: [
        [
          changed(change + 'specs/projects/access/spec.md', 'RENAMED'),
          changed(change + 'design.md', 'MODIFIED'),
        ],
        [
          changed(change + 'tasks.md'),
          changed(change + 'notes.md'),
          changed(change + 'big.md'),
          changed(change + 'link.md'),
        ],
      ],
    },
    trees: {
      'sha5:docs/openspec/changes/add-roles': [
        blob('.openspec.yaml', 'metadata'),
        blob('big.md', 'big', { size: 2_000_001 }),
        blob('design.md', 'design'),
        blob('link.md', 'link', { mode: 0o120000 }),
        blob('notes.md', 'truncated'),
        blob('proposal.md', 'proposal'),
        tree('specs'),
        blob('tasks.md', 'tasks'),
      ],
      'sha5:docs/openspec/changes/add-roles/specs': [tree('projects')],
      'sha5:docs/openspec/changes/add-roles/specs/projects': [tree('access')],
      'sha5:docs/openspec/changes/add-roles/specs/projects/access': [blob('spec.md', 'spec')],
    },
    blobs: {
      metadata: { text: 'schema: spec-driven', isTruncated: false, isBinary: false },
      design: { text: '# Design', isTruncated: false, isBinary: false },
      proposal: { text: '# Add roles', isTruncated: false, isBinary: false },
      tasks: { text: '- [ ] 1.1', isTruncated: false, isBinary: false },
      spec: { text: '## ADDED Requirements', isTruncated: false, isBinary: false },
      truncated: { text: 'Notes', isTruncated: true, isBinary: false },
    },
  });
  const { pullRequests } = await readPullRequests({ ...options, fetch });

  // The list, two more pages of files, four levels of folders and one request for the documents.
  assert.equal(requests.length, 8);
  const [{ files, reviewFiles }] = pullRequests;
  assert.deepEqual(
    files.map((file) => file.path),
    [
      'changes/add-roles/.openspec.yaml',
      'changes/add-roles/design.md',
      'changes/add-roles/proposal.md',
      'changes/add-roles/tasks.md',
      'changes/add-roles/specs/projects/access/spec.md',
    ],
  );
  const diff = (path: string) =>
    'https://github.example/acme/roadmap/pull/5/files#diff-' + sha256(change + path);
  // In the order of the documents; the unchanged metadata and the skipped documents have none.
  assert.deepEqual(reviewFiles, [
    { path: 'changes/add-roles/design.md', url: diff('design.md'), added: false },
    { path: 'changes/add-roles/proposal.md', url: diff('proposal.md'), added: true },
    { path: 'changes/add-roles/tasks.md', url: diff('tasks.md'), added: true },
    // Named by its new path; a rename leaves lines on both sides of the diff.
    {
      path: 'changes/add-roles/specs/projects/access/spec.md',
      url: 'https://github.example/acme/roadmap/pull/5/files#diff-a396d9beb8d0699974db716da3e767c7606971541bbf3ffec9bfc2c8a66a462e',
      added: false,
    },
  ]);
});

test('explains why GitHub could not be read', async () => {
  const answer = (status: number, body: Json) => async () =>
    new Response(JSON.stringify(body), { status });
  const read = (fetch: typeof globalThis.fetch) => readPullRequests({ ...options, fetch });
  const permissions =
    ' The workflow needs the permissions "contents: read" and "pull-requests: read".';
  await assert.rejects(read(answer(403, { message: 'Resource not accessible by integration' })), {
    message: 'GitHub answered 403: Resource not accessible by integration.' + permissions,
  });
  await assert.rejects(read(answer(401, { message: 'Bad credentials' })), {
    message: 'GitHub answered 401: Bad credentials.' + permissions,
  });
  await assert.rejects(
    read(answer(403, { message: 'API rate limit exceeded for installation.' })),
    {
      message: 'GitHub answered 403: API rate limit exceeded for installation.',
    },
  );
  await assert.rejects(
    read(
      answer(200, {
        data: { repository: null },
        errors: [
          {
            type: 'NOT_FOUND',
            message: "Could not resolve to a Repository with the name 'acme/roadmap'.",
          },
        ],
      }),
    ),
    { message: "GitHub answered: Could not resolve to a Repository with the name 'acme/roadmap'." },
  );
  await assert.rejects(
    read(
      answer(200, {
        errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
      }),
    ),
    { message: 'GitHub answered: Resource not accessible by integration.' + permissions },
  );
  await assert.rejects(
    read(
      async () =>
        new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    ),
    { message: 'GitHub answered 502: Bad Gateway.' },
  );
  await assert.rejects(
    read(async () => new Response('<html>Sign in</html>')),
    { message: 'GitHub answered with something other than GraphQL data.' },
  );
  await assert.rejects(
    read(async () => {
      throw new TypeError('fetch failed');
    }),
    { message: 'GitHub could not be reached: fetch failed' },
  );
});
