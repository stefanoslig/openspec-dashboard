import type { ChangedFile, ConnectOptions, GitHubApi, PullRequestNode, Thread } from './api.ts';
import { connect } from './api.ts';
import { changeFolders, documentsAt } from './documents.ts';
import { listOpenPullRequests, remainingPages } from './requests.ts';
import { reviewFiles, threadsOf } from './review.ts';
import type { ArtifactFile, PullRequestInput } from '../workspace/model.ts';

export interface GitHubOptions extends ConnectOptions {
  /** Only pull requests that target this branch are read. */
  branch: string;
  /** The openspec folder, relative to the repository root. */
  folder: string;
}

/** A listed pull request that adds to or modifies a change folder, with all its files and threads. */
interface Candidate {
  node: PullRequestNode;
  changed: ChangedFile[];
  folders: string[];
  threads: Thread[];
}

const capWarning = (listed: number, total: number) =>
  `Only the ${listed} most recently updated open pull requests were read; ${total - listed} were not.`;
const forkWarning = (forks: number) =>
  forks === 1
    ? '1 pull request from a fork was skipped.'
    : forks + ' pull requests from forks were skipped.';

/** The listed pull requests that count, with the rest of their changed files and review threads. */
async function candidatesAmong(
  api: GitHubApi,
  nodes: PullRequestNode[],
  prefix: string,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const node of nodes) {
    if (node.isCrossRepository || !node.files) continue;
    const changed = await remainingPages(api, { number: node.number, key: 'files' }, node.files);
    const folders = changeFolders(changed, prefix);
    if (!folders.length) continue;
    const threads = await remainingPages(
      api,
      { number: node.number, key: 'threads' },
      node.reviewThreads,
    );
    candidates.push({ node, changed, folders, threads });
  }
  return candidates;
}

/** One pull request as the workspace takes it, with the documents read from its change folders. */
function toPullRequest(
  candidate: Candidate,
  files: ArtifactFile[],
  prefix: string,
): PullRequestInput {
  const { node, changed, folders, threads } = candidate;
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? 'ghost',
    draft: node.isDraft,
    branch: node.headRefName,
    commit: node.headRefOid,
    updatedAt: node.updatedAt,
    files,
    threads: threadsOf(threads, folders, prefix),
    reviewFiles: reviewFiles({ url: node.url, changed, documents: files }, prefix),
  };
}

/**
 * Reads the open pull requests that target a branch: the documents of the changes each one adds
 * to or modifies, at its head commit, and the review threads on them.
 */
export async function readPullRequests(
  options: GitHubOptions,
): Promise<{ pullRequests: PullRequestInput[]; warnings: string[] }> {
  // Connect to the repository.
  const api = connect(options);
  const prefix = options.folder ? options.folder + '/' : '';

  // List the open pull requests that target the branch; warn about the ones that are not read.
  const { nodes, listed, total } = await listOpenPullRequests(api, options.branch);
  const warnings: string[] = [];
  if (total > listed) warnings.push(capWarning(listed, total));
  const forks = nodes.filter((node) => node.isCrossRepository).length;
  if (forks) warnings.push(forkWarning(forks));

  // Keep the pull requests that add to or modify a change folder, with all their files and threads.
  const candidates = await candidatesAmong(api, nodes, prefix);

  // Read the documents of their change folders at their head commits.
  const documents = await documentsAt(
    api,
    prefix,
    candidates.map(({ node, folders }) => ({
      number: node.number,
      commit: node.headRefOid,
      folders,
    })),
  );
  warnings.push(...documents.warnings);

  // Shape each one for the workspace.
  return {
    warnings,
    pullRequests: candidates.map((candidate) =>
      toPullRequest(candidate, documents.filesOf(candidate.node.number), prefix),
    ),
  };
}
