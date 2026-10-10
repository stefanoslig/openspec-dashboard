import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactsOf } from './artifact.ts';
import { changesOf, mergedChanges, newestFirst, statusOf, type ChangeContext } from './change.ts';
import { publishedSpecs } from './spec-delta.ts';
import type { Change } from './model.ts';

const file = (path: string, content: string, modified: number | null = null) => ({
  path,
  content,
  modified,
});
const contextOf = (files: ReturnType<typeof file>[], schema = 'spec-driven'): ChangeContext => ({
  schema,
  modified: new Map(files.map((item) => [item.path, item.modified])),
  published: publishedSpecs(artifactsOf(files)),
});
const change = (id: string) => ({ id }) as Change;

test('groups documents under changes/<name> and changes/archive/<name>', () => {
  const files = [
    file('changes/b/tasks.md', '- [x] one\n- [ ] two', 2000),
    file('changes/b/design.md', '# Design', 1000),
    file('changes/b/proposal.md', '# B\n\nSummary of B.', 3000),
    file('changes/b/.openspec.yaml', 'schema: other'),
    file('changes/b/specs/x/spec.md', '## ADDED Requirements\n### Requirement: R'),
    file('changes/archive/2026-01-02-old/proposal.md', '', 5000),
    file('changes/archive/loose.md', 'not a change'),
    file('changes/loose.md', 'not a change either'),
    file('specs/x/spec.md', '## Requirements\n### Requirement: R\nText.'),
    file('config.yaml', 'schema: custom'),
  ];
  const { changes, times, warnings } = changesOf(artifactsOf(files), contextOf(files, 'custom'));
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    changes.map((item) => item.id),
    ['changes/archive/2026-01-02-old', 'changes/b'],
  );
  const [old, b] = changes;
  assert.deepEqual(
    [old.name, old.title, old.archived, old.schema, old.status, old.summary, old.deltas],
    ['2026-01-02-old', 'Old', true, 'custom', 'Draft', '', []],
  );
  assert.deepEqual(
    [b.title, b.archived, b.schema, b.status, b.completed, b.total, b.summary, b.modified],
    ['B', false, 'other', 'In progress', 1, 2, 'Summary of B.', '1970-01-01T00:00:03.000Z'],
  );
  assert.deepEqual(b.documents, [
    'changes/b/proposal.md',
    'changes/b/design.md',
    'changes/b/tasks.md',
    'changes/b/.openspec.yaml',
    'changes/b/specs/x/spec.md',
  ]);
  assert.deepEqual(
    b.deltas.map((delta) => [
      delta.capability,
      delta.published,
      delta.requirements.map((item) => [item.kind, item.name, item.previous]),
    ]),
    [['x', 'specs/x/spec.md', [['added', 'R', '### Requirement: R\nText.']]]],
  );
  assert.deepEqual(
    [...times],
    [
      ['changes/archive/2026-01-02-old', 5000],
      ['changes/b', 3000],
    ],
  );
  assert.equal('pullRequest' in b, false);
});

test('derives the status from the task counts', () => {
  const cases: [number, number][] = [
    [0, 0],
    [0, 3],
    [1, 3],
    [3, 3],
    [2, 0],
  ];
  assert.deepEqual(
    cases.map(([completed, total]) => statusOf(completed, total)),
    ['Draft', 'Planned', 'In progress', 'Complete', 'Draft'],
  );
});

test('warns about invalid metadata and keeps the workspace schema', () => {
  const files = [
    file('changes/m/proposal.md', 'M'),
    file('changes/m/.openspec.yaml', 'schema: ['),
    file('changes/n/.openspec.yaml', 'other: 1'),
    file('changes/n/proposal.md', 'N'),
  ];
  const { changes, times, warnings } = changesOf(artifactsOf(files), contextOf(files));
  assert.deepEqual(
    changes.map((item) => [item.id, item.schema, item.modified]),
    [
      ['changes/m', 'spec-driven', null],
      ['changes/n', 'spec-driven', null],
    ],
  );
  assert.deepEqual([...times.values()], [null, null]);
  assert.deepEqual(warnings, ['Invalid metadata in m.']);
});

test('reads the changes of a pull request under its prefix, dated by its update', () => {
  const disk = [file('specs/access/spec.md', '## Requirements\n### Requirement: A\nOld.')];
  const id = '.pulls/42/changes/archive/2026-10-03-add-admins';
  const pullFiles = [
    file('changes/archive/2026-10-03-add-admins/proposal.md', '# Add admins\n\nIn review.', 9000),
    file(
      'changes/archive/2026-10-03-add-admins/specs/access/spec.md',
      '## MODIFIED Requirements\n### Requirement: A\nNew.',
      9000,
    ),
    file('specs/access/spec.md', '## Requirements\n### Requirement: A\nNew.'),
  ];
  const pull = {
    number: 42,
    title: 'Pull request 42',
    url: 'https://github.example/pull/42',
    author: 'mara',
    draft: false,
    branch: 'add-admins',
    commit: 'sha42',
    updatedAt: '2026-10-02T10:00:00Z',
    files: pullFiles,
    threads: [],
  };
  const docs = artifactsOf(pullFiles, '.pulls/42/', 42);
  const { changes, times, warnings } = changesOf(docs, contextOf(disk), pull);
  assert.deepEqual(warnings, []);
  assert.equal(changes.length, 1);
  const [found] = changes;
  assert.deepEqual(
    [found.id, found.name, found.title, found.archived, found.pullRequest, found.modified],
    [id, '2026-10-03-add-admins', 'Add admins', false, 42, '2026-10-02T10:00:00.000Z'],
  );
  assert.deepEqual(found.documents, [id + '/proposal.md', id + '/specs/access/spec.md']);
  // Not archived, so its delta is matched to the published spec on disk.
  assert.deepEqual(
    found.deltas.map((delta) => [
      delta.path,
      delta.published,
      delta.requirements.map((item) => [item.kind, item.previous]),
    ]),
    [
      [
        id + '/specs/access/spec.md',
        'specs/access/spec.md',
        [['modified', '### Requirement: A\nOld.']],
      ],
    ],
  );
  assert.deepEqual([...times], [[id, Date.parse('2026-10-02T10:00:00Z')]]);
  // An unreadable update time leaves the change undated; the file times do not count.
  const undated = changesOf(docs, contextOf(disk), { ...pull, updatedAt: 'unknown' });
  assert.deepEqual([...undated.times.values()], [null]);
  assert.equal(undated.changes[0].modified, null);
});

test('orders newest first, undated last, ties by id', () => {
  const changes = ['z', 'a', 'm', 'b', 'k'].map(change);
  const times = new Map<string, number | null>([
    ['z', 1000],
    ['a', 1000],
    ['m', null],
    ['b', 1000.5],
    ['k', 2000],
  ]);
  assert.deepEqual(
    newestFirst(changes, times).map((item) => item.id),
    ['k', 'b', 'a', 'z', 'm'],
  );
  assert.deepEqual(
    changes.map((item) => item.id),
    ['z', 'a', 'm', 'b', 'k'],
  );
  assert.deepEqual(
    newestFirst([change('q'), change('p')], new Map()).map((item) => item.id),
    ['p', 'q'],
  );
});

test('merges change sets in their order', () => {
  const first = {
    changes: [change('a')],
    times: new Map<string, number | null>([['a', 1]]),
    warnings: ['first'],
  };
  const second = {
    changes: [change('b')],
    times: new Map<string, number | null>([['b', null]]),
    warnings: [],
  };
  const merged = mergedChanges([first, second]);
  assert.deepEqual(
    merged.changes.map((item) => item.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    [...merged.times],
    [
      ['a', 1],
      ['b', null],
    ],
  );
  assert.deepEqual(merged.warnings, ['first']);
});
