import { parseArgs } from 'node:util';
import { demoDir, version } from './paths.ts';

export const usage = `OpenSpec Desk ${version}: a read-only dashboard for OpenSpec artifacts.

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

export class UsageError extends Error {}

export interface ExportCommand {
  kind: 'export';
  /** Repository root or openspec folder; the bundled sample under --demo. */
  input: string;
  /** Folder that receives the site. */
  out: string;
  demo: boolean;
  pullRequests: boolean;
}

export interface ServeCommand {
  kind: 'serve';
  /** Repository root or openspec folder; the bundled sample under --demo. */
  input: string;
  port: number;
  demo: boolean;
}

export type Command = { kind: 'help' } | { kind: 'version' } | ExportCommand | ServeCommand;

function parseArguments(argv: string[]) {
  return parseArgs({
    args: argv,
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
}

type Options = ReturnType<typeof parseArguments>['values'];

// --port, else PORT, else 4310. Number('') is 0, so an empty PORT asks the OS for a free port.
function portOf(option: string | undefined, env: NodeJS.ProcessEnv): number {
  const port = Number(option ?? env['PORT'] ?? 4310);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError('--port needs a number between 0 and 65535.');
  return port;
}

function exportCommand(input: string, options: Options): ExportCommand {
  if (options.port !== undefined) throw new UsageError('--port applies to the local server only.');
  if (options.demo && options['pull-requests'])
    throw new UsageError('--pull-requests cannot be combined with --demo.');
  return {
    kind: 'export',
    input,
    out: options.out ?? 'site',
    demo: options.demo,
    pullRequests: options['pull-requests'],
  };
}

function serveCommand(input: string, options: Options, env: NodeJS.ProcessEnv): ServeCommand {
  if (options.out !== undefined) throw new UsageError('--out applies to export only.');
  if (options['pull-requests']) throw new UsageError('--pull-requests applies to export only.');
  return { kind: 'serve', input, port: portOf(options.port, env), demo: options.demo };
}

/** Turns the arguments after the script name into a command; parseArgs errors propagate. */
export function parseCommand(argv: string[], env: NodeJS.ProcessEnv): Command {
  const { values, positionals } = parseArguments(argv);
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  // The word `export` picks the command; the path, if any, follows it.
  const exporting = positionals[0] === 'export';
  const paths = exporting ? positionals.slice(1) : positionals;
  if (paths.length > 1) throw new UsageError('Give one path at most.');
  const input = values.demo ? demoDir : (paths[0] ?? '.');

  if (exporting) return exportCommand(input, values);
  return serveCommand(input, values, env);
}
