import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Node is only a development launcher; production runs OpenSpec.Api.dll directly.
const argumentsToApp = process.argv.slice(2);
if (argumentsToApp[0] === '--create-certificate' && argumentsToApp[1])
  argumentsToApp[1] = resolve(argumentsToApp[1]);
const child = spawn(
  'dotnet',
  ['run', '--project', 'backend/OpenSpec.Api', '--no-launch-profile', '--', ...argumentsToApp],
  { stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
