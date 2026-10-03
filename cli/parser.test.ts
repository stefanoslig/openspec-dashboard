import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkspace, humanize, inspectMarkdown } from './parser.ts';

const file = (path: string, content: string, modified: number | null = null) => ({
  path,
  content,
  modified,
});

test('counts actual tasks and headings', () => {
  assert.deepEqual(
    inspectMarkdown(
      '- [x] Done\n- [ ] Pending\n  - [X] Nested\n\n~~~md\n- [ ] Example\n~~~\n\n### Requirement: Read\n#### Scenario: Open',
    ),
    { completed: 2, total: 3, requirements: 1, scenarios: 1, summary: '' },
  );
  assert.equal(
    inspectMarkdown('# Proposal\n\nRead this **proposal**.').summary,
    'Read this proposal.',
  );
  assert.equal(inspectMarkdown('### **Requirement:** `Scenario:` bold').requirements, 1);
  assert.equal(inspectMarkdown('x'.repeat(300)).summary.length, 240);
});

test('humanizes names', () => {
  assert.equal(humanize('2026-09-18-add-project_roles'), 'Add project roles');
  assert.equal(humanize(''), '');
});

test('groups changes, orders documents and derives status', () => {
  const workspace = buildWorkspace(
    [
      file('config.yaml', 'schema: custom'),
      file('changes/b/tasks.md', '- [x] one\n- [ ] two', 2000),
      file('changes/b/design.md', '# Design', 1000),
      file('changes/b/proposal.md', '# B\n\nSummary of B.', 1000),
      file('changes/b/specs/x/spec.md', '### Requirement: R', 1000),
      file('changes/b/.openspec.yaml', 'schema: other', 1000),
      file('changes/a/notes.md', 'Only notes.', 3000),
      file('changes/archive/2026-01-02-old/proposal.md', '', 5000),
      file('changes/archive/loose.md', 'not a change'),
      file('specs/area/thing/spec.md', '### Requirement: A\n#### Scenario: S'),
      file('specs/readme.md', 'not a spec'),
    ],
    { name: 'demo', root: 'openspec', now: new Date(0) },
  );
  assert.equal(workspace.schema, 'custom');
  assert.equal(workspace.loadedAt, '1970-01-01T00:00:00.000Z');
  assert.deepEqual(
    workspace.changes.map((change) => change.id),
    ['changes/archive/2026-01-02-old', 'changes/a', 'changes/b'],
  );
  const [old, a, b] = workspace.changes;
  assert.deepEqual([old.title, old.archived, old.summary], ['Old', true, '']);
  assert.deepEqual([a.status, a.summary], ['Draft', 'Open this change to explore its artifacts.']);
  assert.deepEqual(
    [b.status, b.completed, b.total, b.schema, b.summary, b.modified],
    ['In progress', 1, 2, 'other', 'Summary of B.', '1970-01-01T00:00:02.000Z'],
  );
  assert.deepEqual(b.documents, [
    'changes/b/proposal.md',
    'changes/b/design.md',
    'changes/b/tasks.md',
    'changes/b/.openspec.yaml',
    'changes/b/specs/x/spec.md',
  ]);
  assert.deepEqual(workspace.specs, [
    { path: 'specs/area/thing/spec.md', capability: 'area/thing', requirements: 1, scenarios: 1 },
  ]);
  const proposal = workspace.documents.find((doc) => doc.path === 'changes/b/proposal.md')!;
  assert.deepEqual([proposal.title, proposal.format], ['Proposal', 'markdown']);
  assert.equal(proposal.revision.length, 64);
  assert.equal('source' in workspace, false);
});

test('orders undated changes by id and reports configuration problems', () => {
  const workspace = buildWorkspace(
    [
      file('config.yml', 'store: elsewhere\nschema:\n  nested: true'),
      file('changes/z/proposal.md', 'Z'),
      file('changes/m/proposal.md', 'M'),
      file('changes/m/.openspec.yaml', 'schema: ['),
    ],
    { name: 'demo', root: 'openspec', warnings: ['from reader'] },
  );
  assert.deepEqual(
    workspace.changes.map((change) => [change.id, change.modified, change.schema]),
    [
      ['changes/m', null, 'spec-driven'],
      ['changes/z', null, 'spec-driven'],
    ],
  );
  assert.equal(workspace.warnings.length, 3);
  assert.equal(workspace.warnings[0], 'from reader');
  assert.match(workspace.warnings[1], /external OpenSpec store/);
  assert.equal(workspace.warnings[2], 'Invalid metadata in m.');
  assert.match(
    buildWorkspace([file('config.yaml', 'schema: [')], { name: 'n', root: 'r' }).warnings[0],
    /config\.yaml could not be parsed/,
  );
});

test('matches the requirement changes of a change to the published spec', () => {
  const published =
    '# Access\n\n## Requirements\n\n### Requirement: Owners manage membership\nOwners only.\n\n#### Scenario: An editor looks\n- **THEN** nothing can be changed\n\n### Requirement: Old name\nOld text.\n\n### Requirement: Stays\nKept.\n';
  const delta = [
    '## ADDED Requirements', // 1
    '### Requirement: Brand new',
    'New text.',
    '### Requirement: Stays', // 4
    'Added again.',
    '## MODIFIED Requirements', // 6
    '### Requirement: Owners manage membership',
    'Owners and admins.',
    '### Requirement: New name', // 9
    'New text.',
    '### Requirement: Unknown', // 11
    'Text.',
    '## REMOVED Requirements', // 13
    '### Requirement: Gone already',
    '**Reason**: Unused.',
    '## RENAMED Requirements', // 16
    '- FROM: `### Requirement: Old name`',
    '- TO: `### Requirement: New name`',
    '- FROM: `### Requirement: Stays`', // 19
    '- TO: `### Requirement: Remains`',
  ].join('\n');
  const workspace = buildWorkspace(
    [
      file('specs/access/spec.md', published),
      file('changes/active/specs/access/spec.md', delta),
      file(
        'changes/active/specs/area/fresh/spec.md',
        '## ADDED Requirements\n### Requirement: First',
      ),
      file('changes/active/specs/empty/spec.md', '### Requirement: Outside every section'),
      file(
        'changes/active/proposal.md',
        '## ADDED Requirements\n### Requirement: Not a delta spec',
      ),
      file('changes/archive/2026-01-02-done/specs/access/spec.md', delta),
    ],
    { name: 'demo', root: 'openspec' },
  );
  const [active, done] = workspace.changes;
  assert.deepEqual(done.deltas, []);
  assert.deepEqual(
    active.deltas.map((item) => [item.path, item.capability, item.published]),
    [
      ['changes/active/specs/access/spec.md', 'access', 'specs/access/spec.md'],
      ['changes/active/specs/area/fresh/spec.md', 'area/fresh', null],
    ],
  );
  assert.deepEqual(
    active.deltas[0].requirements.map((change) => [
      change.kind,
      change.name,
      change.previousName,
      change.previous,
      change.line,
      change.endLine,
    ]),
    [
      ['added', 'Brand new', undefined, null, 2, 3],
      ['added', 'Stays', undefined, '### Requirement: Stays\nKept.', 4, 5],
      [
        'modified',
        'Owners manage membership',
        undefined,
        '### Requirement: Owners manage membership\nOwners only.\n\n#### Scenario: An editor looks\n- **THEN** nothing can be changed',
        7,
        8,
      ],
      ['modified', 'New name', 'Old name', '### Requirement: Old name\nOld text.', 9, 10],
      ['modified', 'Unknown', undefined, null, 11, 12],
      ['removed', 'Gone already', undefined, null, 14, 15],
      ['renamed', 'Remains', 'Stays', '### Requirement: Stays\nKept.', 19, 20],
    ],
  );
  assert.deepEqual(
    active.deltas[0].requirements.map((change) => change.text),
    [
      '### Requirement: Brand new\nNew text.',
      '### Requirement: Stays\nAdded again.',
      '### Requirement: Owners manage membership\nOwners and admins.',
      '### Requirement: New name\nNew text.',
      '### Requirement: Unknown\nText.',
      '**Reason**: Unused.',
      '',
    ],
  );
  assert.deepEqual(active.deltas[1].requirements, [
    {
      kind: 'added',
      name: 'First',
      text: '### Requirement: First',
      previous: null,
      line: 2,
      endLine: 2,
    },
  ]);
});

test('adds the changes and review threads of pull requests', () => {
  const published =
    '## Requirements\n### Requirement: Owners manage membership\nOwners only.\n### Requirement: Untouched\nSame.';
  const delta = [
    '## MODIFIED Requirements', // 1
    '### Requirement: Owners manage membership',
    'Owners and admins.',
    '',
    '#### Scenario: An admin looks', // 5
    '- **THEN** membership can be changed',
    '',
    '## ADDED Requirements', // 8
    '### Requirement: Admins exist',
  ].join('\n');
  const pull = (number: number, extra: object) => ({
    number,
    title: 'Pull request ' + number,
    url: 'https://github.example/pull/' + number,
    author: 'mara',
    draft: number === 43,
    branch: 'branch-' + number,
    commit: 'sha' + number,
    updatedAt: `2026-10-0${number - 40}T10:00:00Z`,
    files: [],
    threads: [],
    ...extra,
  });
  const thread = (path: string, line: number | null, extra: object = {}) => ({
    url: 'https://github.example/thread',
    path,
    line,
    resolved: false,
    outdated: false,
    comments: [{ author: 'ivo', body: 'Why?', createdAt: '2026-10-02T08:00:00Z', url: 'u' }],
    omitted: 0,
    ...extra,
  });
  const archivedDelta = 'changes/archive/2026-10-03-add-admins/specs/access/spec.md';
  const workspace = buildWorkspace(
    [
      file('specs/access/spec.md', published),
      file('changes/add-admins/proposal.md', 'On the branch.'),
    ],
    {
      name: 'demo',
      root: 'openspec',
      pullRequests: [
        // Archives the change and applies its delta to the spec, as the usual flow does.
        pull(42, {
          files: [
            file('changes/archive/2026-10-03-add-admins/proposal.md', '# Add admins\n\nIn review.'),
            file('changes/archive/2026-10-03-add-admins/tasks.md', '- [x] one\n- [x] two'),
            file(archivedDelta, delta),
          ],
          threads: [
            thread(archivedDelta, 6),
            thread(archivedDelta, 9, { resolved: true }),
            thread(archivedDelta, 7),
            thread(archivedDelta, null, { outdated: true }),
            thread('changes/archive/2026-10-03-add-admins/proposal.md', 3),
            thread('changes/other/proposal.md', 1),
            thread('specs/access/spec.md', 2),
          ],
        }),
        pull(43, { files: [file('changes/add-admins/proposal.md', 'Another attempt.')] }),
        pull(44, { files: [file('changes/archive/loose.md', 'Not a change.')] }),
      ],
    },
  );
  assert.deepEqual(
    workspace.changes.map((change) => [
      change.id,
      change.title,
      change.archived,
      change.pullRequest,
      change.status,
      change.modified,
    ]),
    [
      [
        '.pulls/43/changes/add-admins',
        'Add admins',
        false,
        43,
        'Draft',
        '2026-10-03T10:00:00.000Z',
      ],
      [
        '.pulls/42/changes/archive/2026-10-03-add-admins',
        'Add admins',
        false,
        42,
        'Complete',
        '2026-10-02T10:00:00.000Z',
      ],
      ['changes/add-admins', 'Add admins', false, undefined, 'Draft', null],
    ],
  );
  const inReview = workspace.changes[1];
  assert.equal(inReview.summary, 'In review.');
  assert.deepEqual(
    inReview.deltas[0].requirements.map((change) => [change.kind, change.name, change.previous]),
    [
      [
        'modified',
        'Owners manage membership',
        '### Requirement: Owners manage membership\nOwners only.',
      ],
      ['added', 'Admins exist', null],
    ],
  );
  assert.deepEqual(
    workspace.documents.map((doc) => [doc.path, doc.pullRequest, doc.modified]),
    [
      ['changes/add-admins/proposal.md', undefined, null],
      ['specs/access/spec.md', undefined, null],
      ['.pulls/42/changes/archive/2026-10-03-add-admins/proposal.md', 42, null],
      ['.pulls/42/' + archivedDelta, 42, null],
      ['.pulls/42/changes/archive/2026-10-03-add-admins/tasks.md', 42, null],
      ['.pulls/43/changes/add-admins/proposal.md', 43, null],
    ],
  );
  assert.deepEqual(workspace.specs.length, 1);
  const [first, second] = workspace.pullRequests!;
  assert.equal(workspace.pullRequests!.length, 2);
  assert.deepEqual(
    { ...first, threads: [] },
    {
      number: 42,
      title: 'Pull request 42',
      url: 'https://github.example/pull/42',
      author: 'mara',
      draft: false,
      branch: 'branch-42',
      commit: 'sha42',
      updatedAt: '2026-10-02T10:00:00Z',
      changes: ['.pulls/42/changes/archive/2026-10-03-add-admins'],
      threads: [],
    },
  );
  assert.deepEqual(
    first.threads.map((item) => [item.path, item.line, item.requirement, item.resolved]),
    [
      ['.pulls/42/' + archivedDelta, 6, 'Owners manage membership', false],
      ['.pulls/42/' + archivedDelta, 9, 'Admins exist', true],
      ['.pulls/42/' + archivedDelta, 7, null, false],
      ['.pulls/42/' + archivedDelta, null, null, false],
      ['.pulls/42/changes/archive/2026-10-03-add-admins/proposal.md', 3, null, false],
    ],
  );
  assert.deepEqual(
    [second.number, second.draft, second.changes, second.threads],
    [43, true, ['.pulls/43/changes/add-admins'], []],
  );

  const none = buildWorkspace([], { name: 'demo', root: 'openspec', pullRequests: [] });
  assert.deepEqual(none.pullRequests, []);
  assert.equal('pullRequests' in buildWorkspace([], { name: 'demo', root: 'openspec' }), false);
});
