import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { buildWorkspace } from './parser.ts';
import type { ArtifactFile, Workspace } from './workspace.model.ts';

export class WorkspaceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const maxFileBytes = 2_000_000;
const unreadable = 'That folder could not be read. Check the path and its permissions.';

export const isArtifact = (name: string) =>
  ['.md', '.yaml', '.yml'].includes(path.extname(name).toLowerCase());

export function checkSize(fileBytes: number, totalBytes: number, count: number): void {
  if (fileBytes > maxFileBytes || totalBytes > 20_000_000 || count > 2000)
    throw new WorkspaceError(
      'Workspace too large: maximum 2 MB per artifact, 20 MB total, and 2,000 artifacts.',
    );
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

export async function readFiles(
  root: string,
): Promise<{ files: ArtifactFile[]; warnings: string[] }> {
  const files: ArtifactFile[] = [];
  const warnings: string[] = [];
  let bytes = 0;
  let entries = 0;
  async function read(file: string): Promise<Buffer> {
    // Cap the actual read as well: a file may grow after its metadata was read.
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of createReadStream(file, { end: maxFileBytes })) {
      length += chunk.length;
      checkSize(length, bytes + length, files.length + 1);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 20)
      throw new WorkspaceError('This workspace exceeds the supported folder depth (20).');
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of children) {
      if (++entries > 10_000)
        throw new WorkspaceError(
          'This openspec folder contains too many entries (maximum 10,000).',
        );
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symbolic link: ${relative}`);
        continue;
      }
      if (entry.name.startsWith('.') && entry.name !== '.openspec.yaml') continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isArtifact(entry.name)) continue;
      const info = await stat(full);
      checkSize(info.size, bytes + info.size, files.length + 1);
      if (!(await realpath(full)).startsWith(root + path.sep)) {
        warnings.push(`Skipped file outside openspec: ${relative}`);
        continue;
      }
      const content = await read(full);
      bytes += content.length;
      files.push({ path: relative, content: content.toString('utf8'), modified: info.mtimeMs });
    }
  }
  try {
    await walk(root, 0);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if ((error as NodeJS.ErrnoException).code) throw new WorkspaceError(unreadable);
    throw error;
  }
  return { files, warnings };
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
    warnings,
  });
}
