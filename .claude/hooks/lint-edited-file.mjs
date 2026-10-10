// Claude Code PostToolUse hook: lints the file the agent just edited and feeds every
// problem back to it, warnings included, so nothing waits for a later review.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const file = JSON.parse(readFileSync(0, 'utf8')).tool_input?.file_path ?? '';
const lintable = /\.(ts|html)$/.test(file) && file.startsWith(root + '/');
if (!lintable) process.exit(0);

const eslint = join(root, 'node_modules', '.bin', 'eslint');
const result = spawnSync(eslint, ['--max-warnings', '0', file], { cwd: root, encoding: 'utf8' });
// A missing ESLint is a setup problem, not a lint result; stay silent rather than nag.
if (result.error || result.status === 0) process.exit(0);

process.stderr.write(
  `ESLint reports problems in ${file}. Fix the ones in the code you touched before moving on.\n` +
    result.stdout +
    result.stderr,
);
process.exit(2);
