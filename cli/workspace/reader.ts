import { createReadStream, type Dirent } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { checkSize, isArtifact, maxFileBytes } from './limits.ts';
import { buildWorkspace } from './build.ts';
import { WorkspaceError } from './error.ts';
import type { ArtifactFile, PullRequestInput, Workspace } from './model.ts';

const unreadable = 'That folder could not be read. Check the path and its permissions.';
const maxDepth = 20;
const maxEntries = 10_000;

/** What one walk of the openspec folder has collected and counted so far. */
interface WalkState {
  root: string;
  files: ArtifactFile[];
  warnings: string[];
  /** Bytes of content kept, checked against the workspace total. */
  bytes: number;
  /** Folder entries seen, counted before any other rule applies to them. */
  entries: number;
}

const isDirectory = (folder: string) =>
  stat(folder).then(
    (info) => info.isDirectory(),
    () => false,
  );

/** Canonical path of the openspec folder for a repository root or the folder itself. */
export async function resolveRoot(input: string, cwd = process.cwd()): Promise<string> {
  let selected = input.trim();
  if (!selected) throw new WorkspaceError('Enter the path to a repository or its openspec folder.');
  if (selected === '~' || selected.startsWith('~/')) selected = homedir() + selected.slice(1);
  selected = path.resolve(cwd, selected);
  if (!(await isDirectory(selected)))
    throw new WorkspaceError(
      'That folder could not be opened. Check the path and its permissions.',
    );
  selected = await realpath(selected);
  const root = path.basename(selected) === 'openspec' ? selected : path.join(selected, 'openspec');
  if (!(await isDirectory(root)))
    throw new WorkspaceError(
      'No openspec folder found. Select a repository containing openspec/, or openspec/ itself.',
    );
  return realpath(root);
}

/** Code-unit order, so documents come out the same on every platform and in every locale. */
function byName(a: Dirent, b: Dirent): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/** The content of one artifact, read within the limits. */
async function readCapped(file: string, state: WalkState): Promise<Buffer> {
  // Cap the actual read as well: a file may grow after its metadata was read.
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of createReadStream(file, { end: maxFileBytes })) {
    length += chunk.length;
    checkSize(length, state.bytes + length, state.files.length + 1);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Keeps one artifact, unless its real path leads outside the openspec folder. */
async function keepFile(full: string, relative: string, state: WalkState): Promise<void> {
  const info = await stat(full);
  checkSize(info.size, state.bytes + info.size, state.files.length + 1);
  if (!(await realpath(full)).startsWith(state.root + path.sep)) {
    state.warnings.push(`Skipped file outside openspec: ${relative}`);
    return;
  }
  const content = await readCapped(full, state);
  state.bytes += content.length;
  state.files.push({ path: relative, content: content.toString('utf8'), modified: info.mtimeMs });
}

/** Applies the skip rules to one entry, then walks a folder or keeps an artifact. */
async function visit(entry: Dirent, depth: number, state: WalkState): Promise<void> {
  const full = path.join(entry.parentPath, entry.name);
  const relative = path.relative(state.root, full).split(path.sep).join('/');
  if (entry.isSymbolicLink()) {
    state.warnings.push(`Skipped symbolic link: ${relative}`);
    return;
  }
  if (entry.name.startsWith('.') && entry.name !== '.openspec.yaml') return;
  if (entry.isDirectory()) return walk(full, depth + 1, state);
  if (!entry.isFile() || !isArtifact(entry.name)) return;
  return keepFile(full, relative, state);
}

/** Visits the children of a folder in name order, within the depth and entry caps. */
async function walk(directory: string, depth: number, state: WalkState): Promise<void> {
  if (depth > maxDepth)
    throw new WorkspaceError('This workspace exceeds the supported folder depth (20).');
  const children = await readdir(directory, { withFileTypes: true });
  children.sort(byName);
  for (const entry of children) {
    if (++state.entries > maxEntries)
      throw new WorkspaceError('This openspec folder contains too many entries (maximum 10,000).');
    await visit(entry, depth, state);
  }
}

export async function readFiles(
  root: string,
): Promise<{ files: ArtifactFile[]; warnings: string[] }> {
  const state: WalkState = { root, files: [], warnings: [], bytes: 0, entries: 0 };
  try {
    await walk(root, 0, state);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if ((error as NodeJS.ErrnoException).code) throw new WorkspaceError(unreadable);
    throw error;
  }
  return { files: state.files, warnings: state.warnings };
}

/** The fictional pull requests of the sample workspace, kept next to its openspec folder. */
export async function samplePullRequests(root: string): Promise<PullRequestInput[]> {
  return JSON.parse(await readFile(path.join(path.dirname(root), 'pull-requests.json'), 'utf8'));
}

export async function readWorkspace(
  input: string,
  options: { demo?: boolean } = {},
): Promise<Workspace> {
  const root = await resolveRoot(input);
  const { files, warnings } = await readFiles(root);
  return buildWorkspace(files, {
    name: options.demo ? 'Atlas' : path.basename(path.dirname(root)),
    root,
    isDemo: options.demo,
    ...(options.demo ? { pullRequests: await samplePullRequests(root) } : {}),
    warnings,
  });
}
