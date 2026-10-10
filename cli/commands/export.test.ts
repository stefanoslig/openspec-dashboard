import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { exportSite } from './export.ts';
import { demoDir } from '../paths.ts';
import type { Workspace } from '../workspace/model.ts';

let folder: string;
let appDir: string;
let repository: string;
const github = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'acme/roadmap',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
  GITHUB_SERVER_URL: 'https://github.example',
};
const published = async (out: string): Promise<Workspace> =>
  JSON.parse(await readFile(path.join(out, 'workspace.json'), 'utf8'));

interface Pull {
  number: number;
  fork?: boolean;
  /** Content by path below docs/openspec. Every document lies directly in its change folder. */
  documents: Record<string, string>;
}
/** Answers the pull request reader the way the GraphQL API shapes its data. */
function api(pulls: Pull[]) {
  const requests: { url: string; authorization: string; variables: Record<string, string> }[] = [];
  const page = (nodes: unknown[]) => ({
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes,
  });
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init!.body));
    const { Authorization: authorization } = init!.headers as Record<string, string>;
    requests.push({ url: String(url), authorization, variables });
    const repository: Record<string, unknown> = {};
    if (query.includes('pullRequests('))
      repository['pullRequests'] = {
        totalCount: pulls.length,
        ...page(
          pulls.map((pull) => ({
            number: pull.number,
            title: 'Pull request ' + pull.number,
            url: 'https://github.example/acme/roadmap/pull/' + pull.number,
            isDraft: false,
            isCrossRepository: pull.fork ?? false,
            author: { login: 'mara' },
            headRefName: 'branch-' + pull.number,
            headRefOid: 'sha' + pull.number,
            updatedAt: '2026-10-01T10:00:00Z',
            files: page(
              Object.keys(pull.documents).map((file) => ({
                path: 'docs/openspec/' + file,
                changeType: 'ADDED',
              })),
            ),
            reviewThreads: page([]),
          })),
        ),
      };
    else
      for (const [key, value] of Object.entries<string>(variables)) {
        if (!/^v\d+$/.test(key)) continue;
        // A folder is asked for as `commit:path`. Its documents get `commit:file` as object id.
        const [commit, target] = value.split(':');
        const { documents } = pulls.find((pull) => 'sha' + pull.number === commit)!;
        repository['o' + key.slice(1)] = query.includes('on Tree')
          ? {
              entries: Object.entries(documents)
                .filter(([file]) => 'docs/openspec/' + path.posix.dirname(file) === target)
                .map(([file, content]) => ({
                  name: path.posix.basename(file),
                  type: 'blob',
                  mode: 0o100644,
                  oid: commit + ':' + file,
                  size: Buffer.byteLength(content),
                })),
            }
          : { text: documents[target], isTruncated: false, isBinary: false };
      }
    return new Response(JSON.stringify({ data: { repository } }));
  };
  return { fetch, requests };
}

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'openspec-export-'));
  appDir = path.join(folder, 'app');
  repository = path.join(folder, 'roadmap');
  await mkdir(path.join(appDir, 'media'), { recursive: true });
  await writeFile(path.join(appDir, 'index.html'), '<app-root></app-root>');
  await writeFile(path.join(appDir, 'media/logo.svg'), '<svg/>');
  await mkdir(path.join(repository, 'docs/openspec/changes/first'), { recursive: true });
  await writeFile(path.join(repository, 'docs/openspec/changes/first/proposal.md'), 'Why.');
});
after(() => rm(folder, { recursive: true, force: true }));

test('writes the dashboard and a workspace without machine details', async () => {
  const { out } = await exportSite({
    input: 'docs',
    out: 'site',
    appDir,
    cwd: repository,
    env: {},
  });
  assert.equal(out, path.join(repository, 'site'));
  assert.equal(await readFile(path.join(out, 'index.html'), 'utf8'), '<app-root></app-root>');
  assert.equal(await readFile(path.join(out, 'media/logo.svg'), 'utf8'), '<svg/>');
  const text = await readFile(path.join(out, 'workspace.json'), 'utf8');
  assert.equal(text.includes(folder), false);
  const workspace: Workspace = JSON.parse(text);
  assert.deepEqual(
    [workspace.name, workspace.root, workspace.isDemo],
    ['docs', 'docs/openspec', false],
  );
  assert.equal('source' in workspace, false);
  assert.equal(workspace.documents[0].modified, null);
  assert.equal(workspace.changes[0].modified, null);
});

test('adds the revision when running in GitHub Actions', async () => {
  // With a token at hand, but without the option: GitHub is not asked.
  const env = { ...github, GITHUB_WORKSPACE: repository, GITHUB_TOKEN: 't0ken' };
  const fetch = async (): Promise<Response> => assert.fail('The export asked GitHub.');
  const { out } = await exportSite({
    input: 'docs',
    out: 'site',
    appDir,
    cwd: repository,
    env,
    fetch,
  });
  const workspace = await published(out);
  assert.equal('pullRequests' in workspace, false);
  assert.deepEqual(workspace.source, {
    provider: 'github',
    repository: 'acme/roadmap',
    ref: 'main',
    commit: github.GITHUB_SHA,
    committedAt: null,
    folder: 'docs/openspec',
    url: 'https://github.example/acme/roadmap',
  });
  assert.equal(workspace.root, 'docs/openspec');
});

test('exports the sample workspace without a revision', async () => {
  const out = path.join(folder, 'sample-site');
  await exportSite({ input: demoDir, demo: true, out, appDir, cwd: repository, env: github });
  const workspace = await published(out);
  assert.deepEqual([workspace.name, workspace.root, workspace.isDemo], ['Atlas', 'openspec', true]);
  assert.equal('source' in workspace, false);
  assert.equal(workspace.changes.length, 4);
  assert.deepEqual(
    workspace.pullRequests!.map((pull) => [pull.number, pull.threads.length]),
    [[128, 3]],
  );
  assert.equal('reviewFiles' in workspace.pullRequests![0], false);
});

test('fails clearly when there is nothing to export', async () => {
  const options = { out: 'site', appDir, cwd: folder, env: {} };
  await assert.rejects(exportSite({ ...options, input: '.' }), /No openspec folder found/);
  await assert.rejects(
    exportSite({ ...options, input: 'roadmap/docs', appDir: path.join(folder, 'none') }),
    /dashboard build is missing/,
  );
});

test('reads the open pull requests when asked', async () => {
  const options = { input: 'docs', appDir, cwd: repository, pullRequests: true };
  const env = { ...github, GITHUB_WORKSPACE: repository, GITHUB_TOKEN: 't0ken', GH_TOKEN: 'other' };
  const { fetch, requests } = api([
    {
      number: 7,
      documents: {
        'changes/add-x/proposal.md': '# Add X',
        'changes/add-x/tasks.md': '- [ ] 1.1 Do it',
      },
    },
    { number: 8, fork: true, documents: { 'changes/from-a-fork/proposal.md': 'Fork.' } },
  ]);
  const { out } = await exportSite({ ...options, out: 'with-pulls', env, fetch });
  const workspace = await published(out);
  const diff = (file: string) =>
    'https://github.example/acme/roadmap/pull/7/files#diff-' +
    createHash('sha256').update(file).digest('hex');
  assert.deepEqual(workspace.pullRequests, [
    {
      number: 7,
      title: 'Pull request 7',
      url: 'https://github.example/acme/roadmap/pull/7',
      author: 'mara',
      draft: false,
      branch: 'branch-7',
      commit: 'sha7',
      updatedAt: '2026-10-01T10:00:00Z',
      changes: ['.pulls/7/changes/add-x'],
      threads: [],
      reviewFiles: [
        {
          path: '.pulls/7/changes/add-x/proposal.md',
          url: diff('docs/openspec/changes/add-x/proposal.md'),
          added: true,
        },
        {
          path: '.pulls/7/changes/add-x/tasks.md',
          url: diff('docs/openspec/changes/add-x/tasks.md'),
          added: true,
        },
      ],
    },
  ]);
  const change = workspace.changes.find((item) => item.id === '.pulls/7/changes/add-x')!;
  assert.deepEqual(
    [change.pullRequest, change.archived, change.documents],
    [7, false, ['.pulls/7/changes/add-x/proposal.md', '.pulls/7/changes/add-x/tasks.md']],
  );
  assert.deepEqual(workspace.warnings, ['1 pull request from a fork was skipped.']);
  assert.deepEqual(requests[0], {
    url: 'https://api.github.com/graphql',
    authorization: 'Bearer t0ken',
    variables: { owner: 'acme', name: 'roadmap', branch: 'main', after: null },
  });

  const other = api([]);
  const elsewhere = {
    ...env,
    GITHUB_TOKEN: '',
    GITHUB_GRAPHQL_URL: 'https://github.example/api/graphql',
  };
  await exportSite({ ...options, out: 'with-pulls', env: elsewhere, fetch: other.fetch });
  assert.deepEqual(
    [other.requests[0].url, other.requests[0].authorization],
    ['https://github.example/api/graphql', 'Bearer other'],
  );
  assert.deepEqual((await published(out)).pullRequests, []);
});

test('names what --pull-requests is missing and writes nothing', async () => {
  const actions = { ...github, GITHUB_WORKSPACE: repository };
  const read = (env: NodeJS.ProcessEnv) =>
    exportSite({
      input: 'docs',
      out: 'unread',
      appDir,
      cwd: repository,
      env,
      pullRequests: true,
      fetch: () => assert.fail('GitHub was asked.'),
    });
  const missing = (names: string) => ({
    message: `--pull-requests needs environment variables that are not set: ${names}. GitHub Actions sets all of them except the token.`,
  });
  await assert.rejects(read(actions), missing('GITHUB_TOKEN (or GH_TOKEN)'));
  await assert.rejects(
    read({ ...actions, GITHUB_TOKEN: 't0ken', GITHUB_REF_NAME: undefined }),
    missing('GITHUB_REF_NAME'),
  );
  await assert.rejects(
    read({ GH_TOKEN: 't0ken' }),
    missing('GITHUB_ACTIONS=true, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME'),
  );
  await assert.rejects(
    read({}),
    missing(
      'GITHUB_ACTIONS=true, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME, GITHUB_TOKEN (or GH_TOKEN)',
    ),
  );
  assert.equal(existsSync(path.join(repository, 'unread')), false);
});

test('writes nothing when GitHub refuses the read', async () => {
  const refused = exportSite({
    input: 'docs',
    out: 'refused',
    appDir,
    cwd: repository,
    env: { ...github, GITHUB_WORKSPACE: repository, GITHUB_TOKEN: 't0ken' },
    pullRequests: true,
    fetch: async () =>
      new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
        status: 403,
      }),
  });
  await assert.rejects(refused, {
    message:
      'GitHub answered 403: Resource not accessible by integration. The workflow needs the permissions "contents: read" and "pull-requests: read".',
  });
  assert.equal(existsSync(path.join(repository, 'refused')), false);
});

test('leaves out the pull requests that exceed the workspace totals', async () => {
  const env = { ...github, GITHUB_WORKSPACE: repository, GITHUB_TOKEN: 't0ken' };
  const exported = async (name: string, pulls: Pull[]) => {
    const { fetch } = api(pulls);
    const { out } = await exportSite({
      input: 'docs',
      out: name,
      appDir,
      cwd: repository,
      env,
      pullRequests: true,
      fetch,
    });
    assert.equal(existsSync(path.join(out, 'index.html')), true);
    return published(out);
  };
  const documents = (change: string, count: number, content: string) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, at) => [`changes/${change}/note-${at}.md`, content]),
    );
  const limits = ' left out: the workspace is limited to 2,000 documents and 20 MB in total.';

  // With the one document on disk, the first pull request reaches 2,000 exactly.
  const counted = await exported('counted', [
    { number: 1, documents: documents('many', 1999, 'Note.') },
    { number: 2, documents: documents('one-more', 1, 'Note.') },
  ]);
  assert.equal(counted.documents.length, 2000);
  assert.deepEqual(
    counted.pullRequests!.map((pull) => pull.number),
    [1],
  );
  assert.deepEqual(counted.warnings, ['1 pull request was' + limits]);

  // Ten documents of 2 MB each, in a million characters each. The last one would fit alone.
  const sized = await exported('sized', [
    { number: 1, documents: documents('small', 1, 'Note.') },
    { number: 2, documents: documents('large', 10, 'é'.repeat(1_000_000)) },
    { number: 3, documents: documents('late', 1, 'Note.') },
  ]);
  assert.deepEqual(
    sized.changes.map((change) => change.id),
    ['.pulls/1/changes/small', 'changes/first'],
  );
  assert.deepEqual(sized.warnings, ['2 pull requests were' + limits]);
});
