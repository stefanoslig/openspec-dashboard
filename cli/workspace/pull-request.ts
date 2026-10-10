import type {
  Change,
  PullRequest,
  PullRequestInput,
  ReviewFile,
  ReviewThread,
  SpecDelta,
} from './model.ts';

/** The documents of a pull request live under this prefix, apart from the ones on disk. */
export const pullRequestPrefix = (number: number) => `.pulls/${number}/`;

const documentsOf = (changes: Change[]) => new Set(changes.flatMap((change) => change.documents));

/** The name of the requirement change whose block spans the line in the delta spec at the path. */
function requirementAt(deltas: SpecDelta[], path: string, line: number | null): string | null {
  if (line === null) return null;
  const delta = deltas.find((candidate) => candidate.path === path);
  const pinned = delta?.requirements.find(
    (change) => change.line <= line && line <= change.endLine,
  );
  return pinned?.name ?? null;
}

/** The threads on the documents of the changes, each pinned to the requirement change at its line. */
function pinnedThreads(
  threads: PullRequestInput['threads'],
  prefix: string,
  changes: Change[],
): ReviewThread[] {
  const owned = documentsOf(changes);
  const deltas = changes.flatMap((change) => change.deltas);
  return threads.flatMap((thread) => {
    const path = prefix + thread.path;
    if (!owned.has(path)) return [];
    return [{ ...thread, path, requirement: requirementAt(deltas, path, thread.line) }];
  });
}

/** The review files of the documents of the changes, with their paths under the prefix. */
function ownedReviewFiles(files: ReviewFile[], prefix: string, changes: Change[]): ReviewFile[] {
  const owned = documentsOf(changes);
  return files.flatMap((file) => {
    const path = prefix + file.path;
    return owned.has(path) ? [{ ...file, path }] : [];
  });
}

/** A pull request with the ids of its changes and the threads and review files on their documents. */
export function pullRequestOf(pull: PullRequestInput, changes: Change[]): PullRequest {
  const { files: _, threads, reviewFiles, ...details } = pull;
  const prefix = pullRequestPrefix(pull.number);
  return {
    ...details,
    changes: changes.map((change) => change.id),
    threads: pinnedThreads(threads, prefix, changes),
    // Older inputs have none: the key stays absent rather than claiming no document changed.
    ...(reviewFiles ? { reviewFiles: ownedReviewFiles(reviewFiles, prefix, changes) } : {}),
  };
}
