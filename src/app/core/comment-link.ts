import type { PullRequest, RequirementChange } from '../../../cli/workspace.model.ts';

/** Where “Comment on GitHub” leads for one requirement. */
export interface CommentLink {
  url: string;
  /** A line of the requirement, the diff of its document, or the pull request's Files changed. */
  target: 'line' | 'file' | 'pull';
}

/**
 * The GitHub destination for a comment on a requirement of the delta document at `path`, a
 * workspace path of the pull request. Only lines the exported data establishes count: every line of
 * a document the pull request adds is on the new side of the diff, and so is a current thread's.
 */
export function commentLink(
  pull: Pick<PullRequest, 'url' | 'threads' | 'reviewFiles'>,
  path: string,
  requirement: Pick<RequirementChange, 'line' | 'endLine'>,
): CommentLink {
  const file = pull.reviewFiles?.find((item) => item.path === path);
  if (!file) return { url: pull.url + '/files', target: 'pull' };
  const lines = file.added
    ? [requirement.line]
    : pull.threads.flatMap(({ path: on, line, outdated }) =>
        on === path &&
        !outdated &&
        line !== null &&
        requirement.line <= line &&
        line <= requirement.endLine
          ? [line]
          : [],
      );
  return lines.length
    ? { url: file.url + 'R' + Math.min(...lines), target: 'line' }
    : { url: file.url, target: 'file' };
}
