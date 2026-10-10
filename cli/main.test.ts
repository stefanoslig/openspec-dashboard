import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const main = path.join(import.meta.dirname, 'main.ts');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', cwd: tmpdir() });

test('prints usage', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /openspec-desk export \[path\]/);
  assert.match(result.stdout, /^ {2}openspec-desk export .*\[--pull-requests\]/m);
  assert.match(result.stdout, /^ {2}--pull-requests {2}\S/m);
});

test('exits with the reason when the workspace or the arguments are wrong', () => {
  const missing = run(path.join(tmpdir(), 'openspec-desk-missing-folder'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /That folder could not be opened/);
  const exported = run('export', path.join(tmpdir(), 'openspec-desk-missing-folder'));
  assert.equal(exported.status, 1);
  for (const args of [['--bogus'], ['--port', 'abc'], ['--out', 'x'], ['a', 'b']]) {
    const result = run(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /--help/);
  }
});

test('accepts --pull-requests for an export of a repository only', () => {
  const server = run('--pull-requests');
  assert.equal(server.status, 1);
  assert.match(server.stderr, /^--pull-requests applies to export only\.\n.*--help/);
  const sample = run('export', '--demo', '--pull-requests', '--out', 'openspec-desk-no-site');
  assert.equal(sample.status, 1);
  assert.match(sample.stderr, /^--pull-requests cannot be combined with --demo\.\n.*--help/);
  assert.equal(existsSync(path.join(tmpdir(), 'openspec-desk-no-site')), false);
});
