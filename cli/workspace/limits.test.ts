import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSize } from './limits.ts';
import { WorkspaceError } from './error.ts';

test('rejects a file, a total or a count above its maximum and accepts the maxima', () => {
  assert.throws(() => checkSize(2_000_001, 2_000_001, 1), WorkspaceError);
  assert.throws(() => checkSize(1, 20_000_001, 1), WorkspaceError);
  assert.throws(() => checkSize(1, 1, 2001), WorkspaceError);
  checkSize(2_000_000, 20_000_000, 2000);
});
