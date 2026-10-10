#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  type ExportCommand,
  parseCommand,
  type ServeCommand,
  UsageError,
  usage,
} from './command.ts';
import { exportSite } from './commands/export.ts';
import { appDir, version } from './paths.ts';
import { readWorkspace } from './workspace/reader.ts';
import { createDashboardServer } from './commands/server.ts';

async function runExport(command: ExportCommand): Promise<void> {
  const { out, workspace } = await exportSite({
    input: command.input,
    demo: command.demo,
    pullRequests: command.pullRequests,
    out: command.out,
    appDir,
  });
  console.log(`Exported ${workspace.documents.length} artifacts to ${out}`);
}

async function serve({ input, demo, port }: ServeCommand): Promise<void> {
  // Read once before listening, so a wrong path fails here and not in the browser.
  const { root } = await readWorkspace(input, { demo });
  if (!existsSync(path.join(appDir, 'index.html')))
    throw new Error('The dashboard build is missing from this installation (dist/app).');

  const server = createDashboardServer({ appDir, load: () => readWorkspace(input, { demo }) });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Choose another with --port.`
        : error.message,
    );
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const bound = typeof address === 'object' && address ? address.port : port;
    console.log(`OpenSpec Desk is reading ${root}\nOpen http://127.0.0.1:${bound}`);
  });
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2), process.env);
  switch (command.kind) {
    case 'help':
      return console.log(usage);
    case 'version':
      return console.log(version);
    case 'export':
      return runExport(command);
    case 'serve':
      return serve(command);
  }
}

main().catch((error: Error & { code?: string }) => {
  const usageProblem = error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS');
  console.error(error.message + (usageProblem ? '\nRun openspec-desk --help for usage.' : ''));
  process.exitCode = 1;
});
