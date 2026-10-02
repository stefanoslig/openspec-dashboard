import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildWorkspace } from './parser.ts';
import { readFiles, resolveRoot } from './reader.ts';
import type { Workspace } from './workspace.model.ts';

export interface ExportOptions {
  /** Repository root or openspec folder. */
  input: string;
  demo?: boolean;
  /** Folder that receives the site. */
  out: string;
  /** Folder with the built dashboard. */
  appDir: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const relative = (from: string, to: string) => path.relative(from, to).split(path.sep).join('/');

/** Revision details that GitHub Actions provides; absent anywhere else. */
function githubSource(env: NodeJS.ProcessEnv, root: string, cwd: string): Workspace['source'] {
  if (env['GITHUB_ACTIONS'] !== 'true' || !env['GITHUB_REPOSITORY'] || !env['GITHUB_SHA'])
    return undefined;
  let checkout = env['GITHUB_WORKSPACE'] || cwd;
  if (existsSync(checkout)) checkout = realpathSync(checkout);
  return {
    provider: 'github',
    repository: env['GITHUB_REPOSITORY'],
    ref: env['GITHUB_REF_NAME'] || env['GITHUB_SHA'],
    commit: env['GITHUB_SHA'],
    committedAt: null,
    folder: relative(checkout, root),
    url: (env['GITHUB_SERVER_URL'] || 'https://github.com') + '/' + env['GITHUB_REPOSITORY'],
  };
}

export async function exportSite(
  options: ExportOptions,
): Promise<{ out: string; workspace: Workspace }> {
  const cwd = options.cwd ?? process.cwd();
  const root = await resolveRoot(options.input, cwd);
  if (!existsSync(path.join(options.appDir, 'index.html')))
    throw new Error('The dashboard build is missing from this installation (dist/app).');
  const { files, warnings } = await readFiles(root);
  const source = options.demo ? undefined : githubSource(options.env ?? process.env, root, cwd);
  // File times after a CI checkout say nothing about the documents, so they are left out.
  const workspace = buildWorkspace(
    files.map((file) => ({ ...file, modified: null })),
    {
      name: options.demo ? 'Atlas' : path.basename(path.dirname(root)),
      root: options.demo
        ? 'openspec'
        : (source?.folder ?? (relative(realpathSync(cwd), root) || '.')),
      isDemo: options.demo,
      source,
      warnings,
    },
  );
  const out = path.resolve(cwd, options.out);
  await mkdir(out, { recursive: true });
  await cp(options.appDir, out, { recursive: true });
  await writeFile(path.join(out, 'workspace.json'), JSON.stringify(workspace));
  return { out, workspace };
}
