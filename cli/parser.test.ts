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
