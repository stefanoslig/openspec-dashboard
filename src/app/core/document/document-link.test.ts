import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWebLink, linkedDocument, linkTarget } from './document-link.ts';

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

test('tells a link to a heading of the same document, decoded', () => {
  const from = 'changes/add-x/proposal.md';
  assert.deepEqual(linkTarget('#phase-2', from, paths), { kind: 'heading', fragment: 'phase-2' });
  assert.deepEqual(linkTarget('#%C3%BCber', from, paths), { kind: 'heading', fragment: 'über' });
});

test('tells a loaded document from one that is missing', () => {
  const from = 'changes/add-x/proposal.md';
  assert.deepEqual(linkTarget('tasks.md#phase-2', from, paths), {
    kind: 'document',
    path: 'changes/add-x/tasks.md',
    fragment: 'phase-2',
  });
  assert.deepEqual(linkTarget('missing.md', from, paths), {
    kind: 'missing',
    path: 'changes/add-x/missing.md',
  });
});

test('tells a link that leaves the workspace from one that cannot be read', () => {
  const from = 'changes/add-x/proposal.md';
  assert.deepEqual(linkTarget('//other.example/x.md', from, paths), { kind: 'outside' });
  assert.deepEqual(linkTarget('#%E0%A4%A', from, paths), { kind: 'broken' });
});

test('tells web links, which open in a new tab, from links within the workspace', () => {
  assert.equal(isWebLink('https://example.com/docs'), true);
  assert.equal(isWebLink('HTTP://example.com'), true);
  assert.equal(isWebLink('mailto:someone@example.com'), true);
  assert.equal(isWebLink('../specs/area/spec.md'), false);
  assert.equal(isWebLink('#phase-2'), false);
  assert.equal(isWebLink('ftp://example.com/file'), false);
});

test('classifies a web link so the browser keeps it', () => {
  assert.deepEqual(linkTarget('https://example.com', 'changes/add-x/proposal.md', paths), {
    kind: 'web',
  });
});
