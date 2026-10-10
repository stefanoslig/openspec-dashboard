// Which documents a pull request brings: the change folders it adds to or modifies, read at its
// head commit.

import type { ChangedFile, Entry, GitHubApi } from './api.ts';
import { gitObjects, type ObjectLookup } from './requests.ts';
import { isArtifact, maxFileBytes } from '../workspace/limits.ts';
import type { ArtifactFile } from '../workspace/model.ts';

/** The change folders of one pull request, to be read at its head commit. */
export interface PullRequestFolders {
  number: number;
  commit: string;
  folders: string[];
}
/** A folder waiting to be listed, `depth` levels below the openspec folder. */
interface PendingFolder {
  number: number;
  commit: string;
  directory: string;
  depth: number;
}
/** A document found in a change folder, to be read by its oid. */
interface DocumentBlob {
  number: number;
  path: string;
  oid: string;
}
/** What one listed folder holds: folders to list next, documents to read, and what was skipped. */
interface FolderListing {
  next: PendingFolder[];
  blobs: DocumentBlob[];
  warnings: string[];
}
interface BlobText {
  text?: string | null;
  isTruncated?: boolean;
  isBinary?: boolean;
}
/** What to do with a tree entry; `skipped` carries the warning to prefix the entry's path with. */
export type Verdict = 'descend' | 'read' | 'ignore' | { skipped: string };

const maxDepth = 20;
// Git's mode of a symbolic link, as the number it is and as GitHub would print it.
const symbolicLinks = [0o120000, 120000];
const treeEntries: ObjectLookup = {
  by: 'expression',
  fields: '... on Tree { entries { name type mode oid size } }',
};
const blobTexts: ObjectLookup = { by: 'oid', fields: '... on Blob { text isTruncated isBinary }' };

/** The change folders, relative to the openspec folder, that a pull request adds to or modifies. */
export function changeFolders(changed: ChangedFile[], prefix: string): string[] {
  const folders = new Set<string>();
  for (const file of changed) {
    if (file.changeType === 'DELETED' || !file.path.startsWith(prefix + 'changes/')) continue;
    const parts = file.path.slice(prefix.length).split('/');
    const depth = parts[1] === 'archive' ? 3 : 2;
    if (parts.length > depth) folders.add(parts.slice(0, depth).join('/'));
  }
  return [...folders];
}

// A hidden entry is not a document, except the change's metadata file.
const isHidden = (name: string) => name.startsWith('.') && name !== '.openspec.yaml';
const isDocument = (entry: Entry) => entry.type === 'blob' && isArtifact(entry.name);

/** What to do with one entry of a folder `depth` levels below the openspec folder. */
export function verdictOn(entry: Entry, depth: number): Verdict {
  if (symbolicLinks.includes(entry.mode)) return { skipped: 'Skipped symbolic link' };
  if (isHidden(entry.name)) return 'ignore';
  if (entry.type === 'tree')
    return depth < maxDepth
      ? 'descend'
      : { skipped: `Skipped a folder below the supported depth (${maxDepth})` };
  if (!isDocument(entry)) return 'ignore';
  if (entry.size > maxFileBytes) return { skipped: 'Skipped a document larger than 2 MB' };
  return 'read';
}

const expressionOf = (prefix: string, folder: PendingFolder) =>
  folder.commit + ':' + prefix + folder.directory;

const foldersOf = (wanted: PullRequestFolders): PendingFolder[] =>
  wanted.folders.map((folder) => ({
    number: wanted.number,
    commit: wanted.commit,
    directory: folder,
    depth: folder.split('/').length,
  }));

function listingOf(folder: PendingFolder, entries: Entry[]): FolderListing {
  const listing: FolderListing = { next: [], blobs: [], warnings: [] };
  for (const entry of entries) {
    const path = folder.directory + '/' + entry.name;
    const verdict = verdictOn(entry, folder.depth);
    if (verdict === 'descend')
      listing.next.push({ ...folder, directory: path, depth: folder.depth + 1 });
    else if (verdict === 'read')
      listing.blobs.push({ number: folder.number, path, oid: entry.oid });
    else if (verdict !== 'ignore')
      listing.warnings.push(`${verdict.skipped} in pull request #${folder.number}: ${path}`);
  }
  return listing;
}

// Folders are listed level by level, for all pull requests at once.
async function listFolders(
  api: GitHubApi,
  prefix: string,
  wanted: PullRequestFolders[],
): Promise<{ blobs: DocumentBlob[]; warnings: string[] }> {
  const blobs: DocumentBlob[] = [];
  const warnings: string[] = [];
  let pending = wanted.flatMap(foldersOf);
  while (pending.length) {
    const trees = await gitObjects<{ entries?: Entry[] }>(
      api,
      treeEntries,
      pending.map((folder) => expressionOf(prefix, folder)),
    );
    const level = pending.map((folder) =>
      listingOf(folder, trees.get(expressionOf(prefix, folder))?.entries ?? []),
    );
    blobs.push(...level.flatMap((listing) => listing.blobs));
    warnings.push(...level.flatMap((listing) => listing.warnings));
    pending = level.flatMap((listing) => listing.next);
  }
  return { blobs, warnings };
}

const isText = (blob: BlobText | null | undefined): blob is BlobText & { text: string } =>
  typeof blob?.text === 'string' && !blob.isTruncated && !blob.isBinary;

/** The documents read from the wanted folders, by pull request number, and what was skipped. */
export async function documentsAt(
  api: GitHubApi,
  prefix: string,
  wanted: PullRequestFolders[],
): Promise<{ filesOf: (number: number) => ArtifactFile[]; warnings: string[] }> {
  const { blobs, warnings } = await listFolders(api, prefix, wanted);
  const texts = await gitObjects<BlobText>(
    api,
    blobTexts,
    blobs.map((blob) => blob.oid),
  );
  const files = new Map<number, ArtifactFile[]>();
  for (const { number, path, oid } of blobs) {
    const text = texts.get(oid);
    if (isText(text))
      files.set(number, [
        ...(files.get(number) ?? []),
        { path, content: text.text, modified: null },
      ]);
    else
      warnings.push(
        `Skipped a document GitHub could not return as text in pull request #${number}: ${path}`,
      );
  }
  // A pull request whose documents were all skipped has none.
  return { filesOf: (number) => files.get(number) ?? [], warnings };
}
