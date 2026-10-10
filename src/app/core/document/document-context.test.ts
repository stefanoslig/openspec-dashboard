import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentContext } from './document-context.ts';

test('places a document of a change by the state of the change', () => {
  assert.deepEqual(documentContext({ change: { archived: true }, inReview: false }), {
    eyebrow: 'Archived change',
    backView: 'archive',
    backLabel: 'Archive',
  });
  assert.deepEqual(documentContext({ change: { archived: false }, inReview: true }), {
    eyebrow: 'Change in review',
    backView: 'changes',
    backLabel: 'All changes',
  });
  assert.deepEqual(documentContext({ change: { archived: false }, inReview: false }), {
    eyebrow: 'Active change',
    backView: 'changes',
    backLabel: 'All changes',
  });
});

test('places a published specification among the specs and any other file among the artifacts', () => {
  assert.deepEqual(documentContext({ inReview: false, capability: 'area' }), {
    eyebrow: 'Specification',
    backView: 'specs',
    backLabel: 'All specifications',
  });
  assert.deepEqual(documentContext({ inReview: false }), {
    eyebrow: 'Workspace artifact',
    backView: 'artifacts',
    backLabel: 'All artifacts',
  });
});
