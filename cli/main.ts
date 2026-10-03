#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exportSite } from './export.ts';
import { appDir, demoDir, version } from './paths.ts';
import { readWorkspace } from './reader.ts';
import { createDashboardServer } from './server.ts';

const usage = `OpenSpec Desk ${version}: a read-only dashboard for OpenSpec artifacts.

Usage:
  openspec-desk [path] [--port <number>] [--demo]
      Serve the dashboard for one workspace on this machine.
  openspec-desk export [path] [--out <folder>] [--pull-requests] [--demo]
      Write a static site that any web host can serve.

  path             Repository root or its openspec folder (default: current folder)
  --port           Port for the local server (default: PORT, then 4310)
  --out            Folder for the exported site (default: site)
  --pull-requests  Include open pull requests (GitHub Actions only, needs GITHUB_TOKEN)
  --demo           Use the bundled sample workspace instead of a path`;

class UsageError extends Error {}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      out: { type: 'string' },
      'pull-requests': { type: 'boolean', default: false },
      demo: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  if (values.help) return console.log(usage);
  if (values.version) return console.log(version);
  const exporting = positionals[0] === 'export';
  const paths = exporting ? positionals.slice(1) : positionals;
  if (paths.length > 1) throw new UsageError('Give one path at most.');
  if (exporting && values.port !== undefined)
    throw new UsageError('--port applies to the local server only.');
  if (!exporting && values.out !== undefined) throw new UsageError('--out applies to export only.');
  if (!exporting && values['pull-requests'])
    throw new UsageError('--pull-requests applies to export only.');
  if (values.demo && values['pull-requests'])
    throw new UsageError('--pull-requests cannot be combined with --demo.');
  const input = values.demo ? demoDir : (paths[0] ?? '.');

  if (exporting) {
    const { out, workspace } = await exportSite({
      input,
      demo: values.demo,
      pullRequests: values['pull-requests'],
      out: values.out ?? 'site',
      appDir,
    });
    console.log(`Exported ${workspace.documents.length} artifacts to ${out}`);
    return;
  }

  const port = Number(values.port ?? process.env['PORT'] ?? 4310);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError('--port needs a number between 0 and 65535.');
  // Read once before listening, so a wrong path fails here and not in the browser.
  const { root } = await readWorkspace(input, { demo: values.demo });
  if (!existsSync(path.join(appDir, 'index.html')))
    throw new Error('The dashboard build is missing from this installation (dist/app).');
  const server = createDashboardServer({
    appDir,
    load: () => readWorkspace(input, { demo: values.demo }),
  });
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

main().catch((error: Error & { code?: string }) => {
  const usageProblem = error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS');
  console.error(error.message + (usageProblem ? '\nRun openspec-desk --help for usage.' : ''));
  process.exitCode = 1;
});
