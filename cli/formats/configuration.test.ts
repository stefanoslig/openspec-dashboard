import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactsOf } from '../workspace/artifact.ts';
import { configuration, workspaceSettings } from './configuration.ts';

const file = (path: string, content: string) => ({ path, content, modified: null });
const settingsOf = (path: string, content: string) =>
  workspaceSettings(artifactsOf([file(path, content)]));

test('reads the top-level scalar keys of the first document', () => {
  assert.deepEqual(
    [...configuration('schema: custom\nstore: elsewhere\nnested:\n  key: 1\nlist:\n  - a\n')],
    [
      ['schema', 'custom'],
      ['store', 'elsewhere'],
      ['nested', null],
      ['list', null],
    ],
  );
  assert.deepEqual([...configuration('schema: first\n---\nschema: second')], [['schema', 'first']]);
});

test('gives an empty map when the root is not a mapping', () => {
  assert.equal(configuration('').size, 0);
  assert.equal(configuration('- a\n- b').size, 0);
  assert.equal(configuration('just text').size, 0);
});

test('throws the first error of any document', () => {
  assert.throws(() => configuration('schema: ['));
  assert.throws(() => configuration('schema: fine\n---\nbroken: ['));
});

test('takes the workspace schema from config.yaml, else spec-driven', () => {
  assert.deepEqual(workspaceSettings([]), { schema: 'spec-driven', warnings: [] });
  assert.deepEqual(settingsOf('config.yaml', 'schema: custom'), { schema: 'custom', warnings: [] });
  assert.equal(settingsOf('config.yml', 'schema: custom').schema, 'custom');
  assert.equal(settingsOf('nested/config.yaml', 'schema: custom').schema, 'spec-driven');
  assert.equal(settingsOf('config.yaml', 'schema:\n  nested: true').schema, 'spec-driven');
});

test('warns about a broken config.yaml and about an external store', () => {
  assert.deepEqual(settingsOf('config.yaml', 'schema: ['), {
    schema: 'spec-driven',
    warnings: ['config.yaml could not be parsed. Its source is still available in Artifacts.'],
  });
  const store = settingsOf('config.yaml', 'store: elsewhere\nschema: custom');
  assert.equal(store.schema, 'custom');
  assert.equal(store.warnings.length, 1);
  assert.match(store.warnings[0], /^This project declares an external OpenSpec store\. /);
});
