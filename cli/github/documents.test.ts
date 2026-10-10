import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entry, GitHubApi } from './api.ts';
import { changeFolders, documentsAt, verdictOn } from './documents.ts';

type Json = Record<string, unknown>;
const changed = (path: string, changeType = 'ADDED') => ({ path, changeType });
const blob = (name: string, oid = name, extra: Partial<Entry> = {}): Entry => ({
  name,
  type: 'blob',
  mode: 0o100644,
  oid,
  size: 100,
  ...extra,
});
const tree = (name: string): Entry => ({
  name,
  type: 'tree',
  mode: 0o040000,
  oid: 'tree',
  size: 0,
});
const skipped = (phrase: string) => ({ skipped: phrase });

test('names the change folders a pull request adds to or modifies', () => {
  assert.deepEqual(
    changeFolders(
      [
        changed('docs/openspec/changes/add-x/proposal.md'),
        changed('docs/openspec/changes/add-x/specs/area/spec.md', 'MODIFIED'),
        changed('docs/openspec/changes/archive/2026-10-03-done/tasks.md', 'RENAMED'),
        changed('docs/openspec/changes/gone/proposal.md', 'DELETED'),
        changed('docs/openspec/changes/archive/loose.md'),
        changed('docs/openspec/changes/loose.md'),
        changed('docs/openspec/specs/area/spec.md', 'MODIFIED'),
        changed('openspec/changes/elsewhere/proposal.md'),
      ],
      'docs/openspec/',
    ),
    ['changes/add-x', 'changes/archive/2026-10-03-done'],
  );
  assert.deepEqual(changeFolders([changed('changes/add-x/proposal.md')], ''), ['changes/add-x']);
});

test('judges a tree entry by the first rule that applies', () => {
  // A symbolic link, in either spelling of its mode, before anything else about it.
  assert.deepEqual(
    verdictOn(blob('link.md', 'link', { mode: 0o120000 }), 2),
    skipped('Skipped symbolic link'),
  );
  assert.deepEqual(
    verdictOn(blob('.link', 'link', { mode: 120000 }), 2),
    skipped('Skipped symbolic link'),
  );
  // Hidden entries, except the change's metadata.
  assert.equal(verdictOn(blob('.hidden.md'), 2), 'ignore');
  assert.equal(verdictOn(tree('.cache'), 2), 'ignore');
  assert.equal(verdictOn(blob('.openspec.yaml'), 2), 'read');
  // Folders, down to the supported depth.
  assert.equal(verdictOn(tree('specs'), 19), 'descend');
  assert.deepEqual(
    verdictOn(tree('specs'), 20),
    skipped('Skipped a folder below the supported depth (20)'),
  );
  // Only blobs that are artifacts.
  assert.equal(verdictOn(blob('logo.png'), 2), 'ignore');
  assert.equal(verdictOn({ ...blob('vendored.md'), type: 'commit' }, 2), 'ignore');
  // Within the size limit.
  assert.deepEqual(
    verdictOn(blob('big.md', 'big', { size: 2_000_001 }), 2),
    skipped('Skipped a document larger than 2 MB'),
  );
  assert.equal(verdictOn(blob('big.md', 'big', { size: 2_000_000 }), 2), 'read');
  assert.equal(verdictOn(blob('proposal.md'), 2), 'read');
});

/** Answers tree and blob lookups by the keys in the variables, the way GitHub aliases them. */
function fakeApi(trees: Record<string, Entry[]>, blobs: Record<string, Json>) {
  const requests: { query: string; variables: Json }[] = [];
  const treeOf = (entries?: Entry[]) => entries && { entries };
  const api: GitHubApi = {
    owner: 'acme',
    name: 'roadmap',
    query: async <T>(query: string, variables: Json) => {
      requests.push({ query, variables });
      const repository: Json = {};
      for (const [key, value] of Object.entries(variables as Record<string, string>)) {
        if (!/^v\d+$/.test(key)) continue;
        const object = query.includes('on Tree') ? treeOf(trees[value]) : blobs[value];
        repository['o' + key.slice(1)] = object ?? null;
      }
      return { repository } as T;
    },
  };
  return { api, requests };
}

test('reads the documents of the change folders at the head commit, level by level for all pull requests', async () => {
  const text = (text: string, extra: Json = {}) => ({
    text,
    isTruncated: false,
    isBinary: false,
    ...extra,
  });
  const { api, requests } = fakeApi(
    {
      'sha7:docs/openspec/changes/add-x': [
        blob('.hidden.md'),
        blob('.openspec.yaml', 'metadata'),
        blob('big.md', 'big', { size: 2_000_001 }),
        blob('link.md', 'link', { mode: 0o120000 }),
        blob('logo.png'),
        blob('proposal.md', 'proposal'),
        tree('specs'),
        tree('.cache'),
      ],
      'sha7:docs/openspec/changes/add-x/specs': [tree('area')],
      'sha7:docs/openspec/changes/add-x/specs/area': [blob('spec.md', 'spec')],
      'sha9:docs/openspec/changes/archive/2026-10-03-done': [
        blob('binary.md', 'binary'),
        blob('tasks.md', 'truncated'),
      ],
    },
    {
      metadata: text('schema: spec-driven'),
      proposal: text('# Add X'),
      spec: text('## ADDED Requirements'),
      truncated: text('- [ ] 1', { isTruncated: true }),
      binary: { text: null, isTruncated: false, isBinary: true },
    },
  );
  const { filesOf, warnings } = await documentsAt(api, 'docs/openspec/', [
    { number: 7, commit: 'sha7', folders: ['changes/add-x'] },
    { number: 9, commit: 'sha9', folders: ['changes/archive/2026-10-03-done'] },
    { number: 11, commit: 'sha11', folders: ['changes/unknown'] },
  ]);
  // One request per level for every pending folder, then one for every document, in blob order.
  assert.deepEqual(
    requests.map((request) => Object.values(request.variables).slice(2)),
    [
      [
        'sha7:docs/openspec/changes/add-x',
        'sha9:docs/openspec/changes/archive/2026-10-03-done',
        'sha11:docs/openspec/changes/unknown',
      ],
      ['sha7:docs/openspec/changes/add-x/specs'],
      ['sha7:docs/openspec/changes/add-x/specs/area'],
      ['metadata', 'proposal', 'binary', 'truncated', 'spec'],
    ],
  );
  assert.deepEqual(filesOf(7), [
    { path: 'changes/add-x/.openspec.yaml', content: 'schema: spec-driven', modified: null },
    { path: 'changes/add-x/proposal.md', content: '# Add X', modified: null },
    { path: 'changes/add-x/specs/area/spec.md', content: '## ADDED Requirements', modified: null },
  ]);
  // A pull request whose documents were all skipped, or whose folder is unknown, has none.
  assert.deepEqual([filesOf(9), filesOf(11)], [[], []]);
  // Tree-walk warnings as encountered, then the blobs GitHub could not return as text.
  assert.deepEqual(warnings, [
    'Skipped a document larger than 2 MB in pull request #7: changes/add-x/big.md',
    'Skipped symbolic link in pull request #7: changes/add-x/link.md',
    'Skipped a document GitHub could not return as text in pull request #9: changes/archive/2026-10-03-done/binary.md',
    'Skipped a document GitHub could not return as text in pull request #9: changes/archive/2026-10-03-done/tasks.md',
  ]);

  // Nothing wanted, nothing asked.
  const nothing = await documentsAt(api, '', []);
  assert.deepEqual([nothing.filesOf(7), nothing.warnings], [[], []]);
  assert.equal(requests.length, 4);
});
