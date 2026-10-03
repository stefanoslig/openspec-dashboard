import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPullRequests } from './github.ts';
import { buildWorkspace } from './parser.ts';
import {
  maxArtifacts,
  maxTotalBytes,
  readFiles,
  resolveRoot,
  samplePullRequests,
} from './reader.ts';
import type { ArtifactFile, PullRequestInput, Workspace } from './workspace.model.ts';

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

export async function exportSite(
  options: ExportOptions,
): Promise<{ out: string; workspace: Workspace }> {
  const cwd = options.cwd ?? process.cwd();
  const root = await resolveRoot(options.input, cwd);
  if (!existsSync(path.join(options.appDir, 'index.html')))
    throw new Error('The dashboard build is missing from this installation (dist/app).');
  const { files, warnings } = await readFiles(root);
  const env = options.env ?? process.env;
  const source = options.demo ? undefined : githubSource(env, root, cwd);
  let pullRequests = options.demo ? await samplePullRequests(root) : undefined;
  if (options.pullRequests && !options.demo) {
    const read = await openPullRequests(env, source, options.fetch);
    warnings.push(...read.warnings);
    pullRequests = withinTotals(files, read.pullRequests, warnings);
  }
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
      ...(pullRequests ? { pullRequests } : {}),
      warnings,
    },
  );
  // Nothing is written before this point, so a failed read leaves the last export as it was.
  const out = path.resolve(cwd, options.out);
  await mkdir(out, { recursive: true });
  await cp(options.appDir, out, { recursive: true });
  await writeFile(path.join(out, 'workspace.json'), JSON.stringify(workspace));
  return { out, workspace };
}
