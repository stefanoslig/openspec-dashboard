import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand, UsageError, usage } from './command.ts';
import { demoDir, version } from './paths.ts';

const parse = (argv: string[], env: NodeJS.ProcessEnv = {}) => parseCommand(argv, env);
const rejects = (argv: string[], message: string) =>
  assert.throws(
    () => parse(argv),
    (error: unknown) => {
      assert.ok(error instanceof UsageError, `${argv.join(' ')} should be a usage error`);
      assert.equal(error.message, message);
      return true;
    },
  );

test('--help and --version come before any check', () => {
  assert.deepEqual(parse(['--help']), { kind: 'help' });
  assert.deepEqual(parse(['-h', 'a', 'b']), { kind: 'help' });
  assert.deepEqual(parse(['--version']), { kind: 'version' });
  assert.deepEqual(parse(['--version', '--out', 'x']), { kind: 'version' });
  assert.deepEqual(parse(['--help', '--version']), { kind: 'help' });
  assert.match(usage, new RegExp(`^OpenSpec Desk ${version.replaceAll('.', '\\.')}: `));
});

test('export takes the path after the word, out defaults to site', () => {
  assert.deepEqual(parse(['export']), {
    kind: 'export',
    input: '.',
    out: 'site',
    demo: false,
    pullRequests: false,
  });
  assert.deepEqual(parse(['export', 'repo', '--out', 'public', '--pull-requests']), {
    kind: 'export',
    input: 'repo',
    out: 'public',
    demo: false,
    pullRequests: true,
  });
});

test('serve takes the port from --port, then PORT, then 4310', () => {
  const serving = (port: number) => ({ kind: 'serve', input: '.', port, demo: false });
  assert.deepEqual(parse([]), serving(4310));
  assert.deepEqual(parse(['repo']), { kind: 'serve', input: 'repo', port: 4310, demo: false });
  assert.deepEqual(parse([], { PORT: '5000' }), serving(5000));
  assert.deepEqual(parse(['--port', '6000'], { PORT: '5000' }), serving(6000));
  assert.deepEqual(parse(['--port=0']), serving(0));
  assert.deepEqual(parse(['--port', '65535']), serving(65535));
  assert.deepEqual(parse([], { PORT: '' }), serving(0));
});

test('--demo reads the bundled sample instead of a path', () => {
  const demo = { kind: 'serve', input: demoDir, port: 4310, demo: true };
  assert.deepEqual(parse(['--demo']), demo);
  assert.deepEqual(parse(['--demo', 'repo']), demo);
  assert.deepEqual(parse(['export', '--demo']), {
    kind: 'export',
    input: demoDir,
    out: 'site',
    demo: true,
    pullRequests: false,
  });
});

test('rejects options that belong to the other command', () => {
  rejects(['a', 'b'], 'Give one path at most.');
  rejects(['export', 'a', 'b'], 'Give one path at most.');
  rejects(['export', '--port', '1'], '--port applies to the local server only.');
  rejects(['--out', 'x'], '--out applies to export only.');
  rejects(['--pull-requests'], '--pull-requests applies to export only.');
  rejects(['--demo', '--pull-requests'], '--pull-requests applies to export only.');
  rejects(
    ['export', '--demo', '--pull-requests'],
    '--pull-requests cannot be combined with --demo.',
  );
});

test('rejects a port that is not an integer from 0 to 65535', () => {
  const message = '--port needs a number between 0 and 65535.';
  rejects(['--port', 'abc'], message);
  rejects(['--port', '70000'], message);
  rejects(['--port=-1'], message);
  rejects(['--port', '1.5'], message);
  assert.throws(() => parse([], { PORT: 'abc' }), { message });
});

test('lets parseArgs reject an unknown option or a value that looks like one', () => {
  assert.throws(() => parse(['--bogus']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  assert.throws(() => parse(['--port']), { code: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' });
  assert.throws(() => parse(['--port', '-1']), { code: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' });
});
