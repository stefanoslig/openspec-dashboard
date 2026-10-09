import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedDocument } from './document-link.ts';

const paths = [
  'changes/add-x/proposal.md',
  'changes/add-x/tasks.md',
  'specs/area/spec.md',
  '.pulls/7/changes/add-y/proposal.md',
  '.pulls/7/changes/add-y/design.md',
];

test('resolves a link against the folder of the document that carries it', () => {
  assert.deepEqual(linkedDocument('tasks.md#phase-2', 'changes/add-x/proposal.md', paths), {
    path: 'changes/add-x/tasks.md',
    fragment: 'phase-2',
  });
  assert.deepEqual(linkedDocument('../../specs/area/spec.md', 'changes/add-x/proposal.md', paths), {
    path: 'specs/area/spec.md',
    fragment: '',
  });
});

test('decodes the path and the fragment', () => {
  assert.deepEqual(
    linkedDocument('Design%20notes.md#%C3%BCber', 'changes/add-x/proposal.md', paths),
    { path: 'changes/add-x/Design notes.md', fragment: 'über' },
  );
});

test('keeps a link within its pull request, or falls back to the published document', () => {
  const from = '.pulls/7/changes/add-y/proposal.md';
  assert.equal(linkedDocument('design.md', from, paths)?.path, '.pulls/7/changes/add-y/design.md');
  assert.equal(linkedDocument('../../specs/area/spec.md', from, paths)?.path, 'specs/area/spec.md');
});

test('returns the path of a document that is not loaded, for the caller to warn about', () => {
  assert.equal(
    linkedDocument('missing.md', 'changes/add-x/proposal.md', paths)?.path,
    'changes/add-x/missing.md',
  );
});

test('ignores a link that leaves the workspace', () => {
  assert.equal(linkedDocument('//other.example/x.md', 'changes/add-x/proposal.md', paths), null);
});
