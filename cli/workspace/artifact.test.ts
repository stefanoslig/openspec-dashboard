import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactsOf, humanize, isoDate, ordinal } from './artifact.ts';

const file = (path: string, content: string, modified: number | null = null) => ({
  path,
  content,
  modified,
});

test('humanizes names', () => {
  assert.equal(humanize('2026-09-18-add-project_roles'), 'Add project roles');
  assert.equal(humanize(''), '');
});

test('orders strings by code unit', () => {
  assert.deepEqual(['b', 'B', 'a', 'é', 'A'].sort(ordinal), ['A', 'B', 'a', 'b', 'é']);
  assert.equal(ordinal('same', 'same'), 0);
});

test('formats an epoch as an ISO date', () => {
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(2000), '1970-01-01T00:00:02.000Z');
});

test('turns files into artifacts sorted by path', () => {
  const docs = artifactsOf([
    file('changes/a/tasks.md', '- [x] one\n- [ ] two', 2000),
    file('changes/a/.openspec.yaml', 'schema: x\n- [ ] not a task'),
    file('changes/a/notes.MD', '# Notes\n\nSome **notes**.'),
    file('changes/a/proposal.md', ''),
    file('specs/x/spec.md', '### Requirement: R\n#### Scenario: S'),
  ]);
  assert.deepEqual(
    docs.map((doc) => [doc.path, doc.title, doc.format]),
    [
      ['changes/a/.openspec.yaml', '.openspec', 'yaml'],
      ['changes/a/notes.MD', 'Notes', 'markdown'],
      ['changes/a/proposal.md', 'Proposal', 'markdown'],
      ['changes/a/tasks.md', 'Tasks', 'markdown'],
      ['specs/x/spec.md', 'Specification', 'markdown'],
    ],
  );
  const [yaml, notes, proposal, tasks, spec] = docs;
  assert.deepEqual(
    [yaml.completed, yaml.total, yaml.requirements, yaml.scenarios, yaml.summary],
    [0, 0, 0, 0, ''],
  );
  assert.deepEqual([notes.summary, notes.modified], ['Some notes.', null]);
  assert.deepEqual(
    [tasks.completed, tasks.total, tasks.content, tasks.modified],
    [1, 2, '- [x] one\n- [ ] two', '1970-01-01T00:00:02.000Z'],
  );
  assert.deepEqual([spec.requirements, spec.scenarios], [1, 1]);
  assert.equal(
    proposal.revision,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.notEqual(tasks.revision, proposal.revision);
  assert.equal('pullRequest' in tasks, false);
});

test('prefixes the artifacts of a pull request and keeps its number', () => {
  const [doc] = artifactsOf([file('changes/a/proposal.md', '# A')], '.pulls/7/', 7);
  assert.deepEqual(
    [doc.path, doc.pullRequest, doc.title],
    ['.pulls/7/changes/a/proposal.md', 7, 'Proposal'],
  );
});
