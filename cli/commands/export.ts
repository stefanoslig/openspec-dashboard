import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPullRequests } from '../github/pull-requests.ts';
import { maxArtifacts, maxTotalBytes } from '../workspace/limits.ts';
import { buildWorkspace } from '../workspace/build.ts';
import { readFiles, resolveRoot, samplePullRequests } from '../workspace/reader.ts';
import type { ArtifactFile, PullRequestInput, Workspace } from '../workspace/model.ts';

export interface ExportOptions {
  /** Repository root or openspec folder. */
  input: string;
  demo?: boolean;
  /** Also read the open pull requests that target the exported branch. Needs GitHub Actions. */
  pullRequests?: boolean;
  /** Folder that receives the site. */
  out: string;
  /** Folder with the built dashboard. */
  appDir: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetch?: typeof fetch;
}
/** The options with their defaults in place, so every step resolves paths the same way. */
interface SettledOptions extends ExportOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
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

/** Reads the open pull requests with what GitHub Actions provides, or says what is missing. */
function openPullRequests(
  env: NodeJS.ProcessEnv,
  source: Workspace['source'],
  request?: typeof fetch,
) {
  const branch = env['GITHUB_REF_NAME'];
  const token = env['GITHUB_TOKEN'] || env['GH_TOKEN'];
  if (!source || !branch || !token) {
    // No source means one of the first three is missing.
    const missing = [
      ...(env['GITHUB_ACTIONS'] === 'true' ? [] : ['GITHUB_ACTIONS=true']),
      ...['GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_REF_NAME'].filter((name) => !env[name]),
      ...(token ? [] : ['GITHUB_TOKEN (or GH_TOKEN)']),
    ];
    throw new Error(
      `--pull-requests needs environment variables that are not set: ${missing.join(', ')}. GitHub Actions sets all of them except the token.`,
    );
  }
  return readPullRequests({
    graphqlUrl: env['GITHUB_GRAPHQL_URL'] || 'https://api.github.com/graphql',
    token,
    repository: source.repository,
    branch,
    folder: source.folder,
    fetch: request,
  });
}

/** The pull requests whose documents fit the workspace totals next to the files from disk. */
function withinTotals(
  files: ArtifactFile[],
  pulls: PullRequestInput[],
  warnings: string[],
): PullRequestInput[] {
  const size = (list: ArtifactFile[]) =>
    list.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  let count = files.length;
  let bytes = size(files);
  // What does not fit is left out and the export goes on; on disk the same totals are an error.
  const first = pulls.findIndex((pull) => {
    count += pull.files.length;
    bytes += size(pull.files);
    return count > maxArtifacts || bytes > maxTotalBytes;
  });
  if (first < 0) return pulls;
  const left = pulls.length - first;
  warnings.push(
    (left === 1 ? '1 pull request was' : left + ' pull requests were') +
      ' left out: the workspace is limited to 2,000 documents and 20 MB in total.',
  );
  return pulls.slice(0, first);
}

// The root the exported site shows: fixed for the sample, else where the folder sits in the
// checkout or, outside GitHub Actions, in the working folder.
function exportedRoot(options: SettledOptions, source: Workspace['source'], root: string): string {
  if (options.demo) return 'openspec';
  if (source) return source.folder;
  return relative(realpathSync(options.cwd), root) || '.';
}

/** The workspace to export: the folder's documents and, when asked for, the open pull requests. */
async function workspaceToExport(options: SettledOptions, root: string): Promise<Workspace> {
  const { files, warnings } = await readFiles(root);
  const source = options.demo ? undefined : githubSource(options.env, root, options.cwd);
  let pullRequests = options.demo ? await samplePullRequests(root) : undefined;
  if (options.pullRequests && !options.demo) {
    const open = await openPullRequests(options.env, source, options.fetch);
    warnings.push(...open.warnings);
    pullRequests = withinTotals(files, open.pullRequests, warnings);
  }
  // File times after a CI checkout say nothing about the documents, so they are left out.
  return buildWorkspace(
    files.map((file) => ({ ...file, modified: null })),
    {
      name: options.demo ? 'Atlas' : path.basename(path.dirname(root)),
      root: exportedRoot(options, source, root),
      isDemo: options.demo,
      source,
      ...(pullRequests ? { pullRequests } : {}),
      warnings,
    },
  );
}

/** Writes the built dashboard and the workspace it shows into the output folder. */
async function writeSite(appDir: string, out: string, workspace: Workspace): Promise<void> {
  await mkdir(out, { recursive: true });
  await cp(appDir, out, { recursive: true });
  await writeFile(path.join(out, 'workspace.json'), JSON.stringify(workspace));
}

export async function exportSite(
  options: ExportOptions,
): Promise<{ out: string; workspace: Workspace }> {
  const settled: SettledOptions = {
    ...options,
    env: options.env ?? process.env,
    cwd: options.cwd ?? process.cwd(),
  };
  const root = await resolveRoot(settled.input, settled.cwd);
  if (!existsSync(path.join(settled.appDir, 'index.html')))
    throw new Error('The dashboard build is missing from this installation (dist/app).');
  const workspace = await workspaceToExport(settled, root);
  // Nothing is written before this point, so a failed read leaves the last export as it was.
  const out = path.resolve(settled.cwd, settled.out);
  await writeSite(settled.appDir, out, workspace);
  return { out, workspace };
}
