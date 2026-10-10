// What a review says about the documents a pull request brings: the threads on them, and where
// the diff of each changed document is.

import { createHash } from 'node:crypto';
import type { ChangedFile, Thread } from './api.ts';
import type { ArtifactFile, PullRequestInput, ReviewFile } from '../workspace/model.ts';

// Only a line on the new side of a current diff is a line of the document at the head.
const lineAtHead = (thread: Thread) =>
  thread.subjectType === 'LINE' && thread.diffSide === 'RIGHT' && !thread.isOutdated
    ? thread.line
    : null;

/** The threads on the documents of the change folders, with paths relative to the openspec folder. */
export function threadsOf(
  threads: Thread[],
  folders: string[],
  prefix: string,
): PullRequestInput['threads'] {
  return threads
    .filter(
      (thread) =>
        thread.comments.nodes.length &&
        folders.some((folder) => thread.path.startsWith(prefix + folder + '/')),
    )
    .map((thread) => ({
      url: thread.comments.nodes[0].url,
      path: thread.path.slice(prefix.length),
      line: lineAtHead(thread),
      resolved: thread.isResolved,
      outdated: thread.isOutdated,
      comments: thread.comments.nodes.map((comment) => ({
        author: comment.author?.login ?? 'ghost',
        body: comment.body,
        createdAt: comment.createdAt,
        url: comment.url,
      })),
      omitted: thread.comments.totalCount - thread.comments.nodes.length,
    }));
}

/** A pull request's page, the files it changes, and the documents read from it. */
export interface PullRequestFiles {
  url: string;
  changed: ChangedFile[];
  documents: ArtifactFile[];
}

/** The imported documents that a pull request changes, with their diffs in its Files changed view. */
export function reviewFiles(
  { url, changed, documents }: PullRequestFiles,
  prefix: string,
): ReviewFile[] {
  const types = new Map(changed.map((file) => [file.path, file.changeType]));
  return documents.flatMap((file) => {
    const path = prefix + file.path;
    const type = types.get(path);
    if (!type) return [];
    // GitHub names a file's diff after the SHA-256 of its path in the repository.
    const anchor = createHash('sha256').update(path, 'utf8').digest('hex');
    return [{ path: file.path, url: url + '/files#diff-' + anchor, added: type === 'ADDED' }];
  });
}
