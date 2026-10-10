import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { inspectMarkdown } from '../formats/markdown-info.ts';
import type { Artifact, ArtifactFile } from './model.ts';

const labels = new Map([
  ['proposal', 'Proposal'],
  ['design', 'Design'],
  ['tasks', 'Tasks'],
  ['refine', 'Requirements'],
  ['spec', 'Specification'],
]);

// Code-unit order, so results do not depend on the machine's locale.
export function ordinal(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function humanize(value: string): string {
  const words = value.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Epoch milliseconds as an ISO string; an unknown time stays null. */
export function isoDate(epoch: number | null | undefined): string | null {
  // A hand-written sample file may leave the key out, which is as unknown as null.
  return epoch == null ? null : new Date(epoch).toISOString();
}

function artifactOf(file: ArtifactFile, prefix: string, pullRequest?: number): Artifact {
  const markdown = file.path.toLowerCase().endsWith('.md');
  const filename = posix.parse(file.path).name;
  return {
    path: prefix + file.path,
    title: labels.get(filename) ?? humanize(filename),
    content: file.content,
    format: markdown ? 'markdown' : 'yaml',
    modified: isoDate(file.modified),
    revision: createHash('sha256').update(file.content, 'utf8').digest('hex'),
    ...inspectMarkdown(markdown ? file.content : ''),
    ...(pullRequest === undefined ? {} : { pullRequest }),
  };
}

/** The artifacts of the files, sorted by path. Those of a pull request carry its number and prefix. */
export function artifactsOf(files: ArtifactFile[], prefix = '', pullRequest?: number): Artifact[] {
  return files
    .map((file) => artifactOf(file, prefix, pullRequest))
    .sort((a, b) => ordinal(a.path, b.path));
}
