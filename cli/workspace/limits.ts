// What a workspace may hold: the size limits and what counts as an artifact, shared by the reads
// from disk and from GitHub.

import path from 'node:path';
import { WorkspaceError } from './error.ts';

export const maxFileBytes = 2_000_000;
export const maxTotalBytes = 20_000_000;
export const maxArtifacts = 2000;

export const isArtifact = (name: string) =>
  ['.md', '.yaml', '.yml'].includes(path.extname(name).toLowerCase());

export function checkSize(fileBytes: number, totalBytes: number, count: number): void {
  if (fileBytes > maxFileBytes || totalBytes > maxTotalBytes || count > maxArtifacts)
    throw new WorkspaceError(
      'Workspace too large: maximum 2 MB per artifact, 20 MB total, and 2,000 artifacts.',
    );
}
