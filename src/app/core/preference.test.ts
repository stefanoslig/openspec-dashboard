import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFlag, writeFlag } from './preference.ts';

/** Stands in for the browser's storage, which Node does not have. */
function useStorage(storage: Partial<Storage>): void {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

test('reads a flag back as it was written', () => {
  const items = new Map<string, string>();
  useStorage({
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  });
  assert.equal(readFlag('flag'), false);
  writeFlag('flag', true);
  assert.equal(items.get('flag'), 'true');
  assert.equal(readFlag('flag'), true);
  writeFlag('flag', false);
  assert.equal(readFlag('flag'), false);
});

test('treats storage that is unavailable as an unset flag', () => {
  const blocked = () => {
    throw new Error('blocked');
  };
  useStorage({ getItem: blocked, setItem: blocked });
  assert.equal(readFlag('flag'), false);
  assert.doesNotThrow(() => writeFlag('flag', true));
  Reflect.deleteProperty(globalThis, 'localStorage');
  assert.equal(readFlag('flag'), false);
});
