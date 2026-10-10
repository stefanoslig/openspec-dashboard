import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactsOf } from './artifact.ts';
import { deltasOf, publishedSpecs } from './spec-delta.ts';

const file = (path: string, content: string) => ({ path, content, modified: null });
const published = publishedSpecs(
  artifactsOf([
    file(
      'specs/access/spec.md',
      '# Access\n\n## Requirements\n\n### Requirement: Owners manage membership\nOwners only.\n\n### Requirement: Old name\nOld text.\n\n### Requirement: Stays\nKept.\n',
    ),
    file('specs/readme.md', '## Requirements\n### Requirement: Not in a spec'),
  ]),
);
const deltaOf = (content: string) =>
  deltasOf('changes/x', artifactsOf([file('changes/x/specs/access/spec.md', content)]), published);

test('looks published specs up by capability, once', () => {
  const access = published('access');
  assert.equal(access?.path, 'specs/access/spec.md');
  assert.deepEqual(
    [...(access?.requirements ?? [])],
    [
      ['Owners manage membership', '### Requirement: Owners manage membership\nOwners only.'],
      ['Old name', '### Requirement: Old name\nOld text.'],
      ['Stays', '### Requirement: Stays\nKept.'],
    ],
  );
  assert.equal(published('access'), access);
  assert.equal(published('missing'), undefined);
  assert.equal(published('readme'), undefined);
});

test('derives each kind of requirement change against the published spec', () => {
  const [delta] = deltaOf(
    [
      '## ADDED Requirements', // 1
      '### Requirement: Brand new',
      'New text.',
      '## MODIFIED Requirements', // 4
      '### Requirement: Owners manage membership',
      'Owners and admins.',
      '## REMOVED Requirements', // 7
      '### Requirement: Stays',
      '**Reason**: Unused.',
      '## RENAMED Requirements', // 10
      '- FROM: `### Requirement: Old name`',
      '- TO: `### Requirement: Fresh name`',
    ].join('\n'),
  );
  assert.deepEqual(
    [delta.path, delta.capability, delta.published],
    ['changes/x/specs/access/spec.md', 'access', 'specs/access/spec.md'],
  );
  assert.deepEqual(delta.requirements, [
    {
      kind: 'added',
      name: 'Brand new',
      text: '### Requirement: Brand new\nNew text.',
      line: 2,
      endLine: 3,
      previous: null,
    },
    {
      kind: 'modified',
      name: 'Owners manage membership',
      text: '### Requirement: Owners manage membership\nOwners and admins.',
      line: 5,
      endLine: 6,
      previous: '### Requirement: Owners manage membership\nOwners only.',
    },
    {
      kind: 'removed',
      name: 'Stays',
      text: '**Reason**: Unused.',
      line: 8,
      endLine: 9,
      previous: '### Requirement: Stays\nKept.',
    },
    {
      kind: 'renamed',
      name: 'Fresh name',
      previousName: 'Old name',
      text: '',
      previous: '### Requirement: Old name\nOld text.',
      line: 11,
      endLine: 12,
    },
  ]);
});

test('merges a rename with the modification under the new name', () => {
  const [delta] = deltaOf(
    [
      '## MODIFIED Requirements', // 1
      '### Requirement: Fresh name',
      'New text.',
      '## RENAMED Requirements', // 4
      '- FROM: `### Requirement: Old name`',
      '- TO: `### Requirement: Fresh name`',
    ].join('\n'),
  );
  assert.deepEqual(delta.requirements, [
    {
      kind: 'modified',
      name: 'Fresh name',
      text: '### Requirement: Fresh name\nNew text.',
      line: 2,
      endLine: 3,
      previousName: 'Old name',
      previous: '### Requirement: Old name\nOld text.',
    },
  ]);
});

test('reads only delta specs with requirement changes, by line', () => {
  const docs = artifactsOf([
    file('changes/x/proposal.md', '## ADDED Requirements\n### Requirement: Not a delta spec'),
    file('changes/x/specs/notes.md', '## ADDED Requirements\n### Requirement: Not a spec'),
    file('changes/x/specs/empty/spec.md', '### Requirement: Outside every section'),
    file(
      'changes/x/specs/area/fresh/spec.md',
      '## REMOVED Requirements\n### Requirement: Gone\n## ADDED Requirements\n### Requirement: First',
    ),
  ]);
  const deltas = deltasOf('changes/x', docs, published);
  assert.deepEqual(
    deltas.map((delta) => [delta.path, delta.capability, delta.published]),
    [['changes/x/specs/area/fresh/spec.md', 'area/fresh', null]],
  );
  assert.deepEqual(
    deltas[0].requirements.map((change) => [
      change.kind,
      change.name,
      change.line,
      change.previous,
    ]),
    [
      ['removed', 'Gone', 2, null],
      ['added', 'First', 4, null],
    ],
  );
});
