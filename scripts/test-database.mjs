import { spawn } from 'node:child_process';

if (!process.env.TEST_DATABASE_CONNECTION)
  throw new Error('Set TEST_DATABASE_CONNECTION to a disposable PostgreSQL database.');
const child = spawn(
  'dotnet',
  ['test', 'backend/OpenSpec.Api.Tests', '--filter', 'Category=PostgreSQL'],
  { stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
