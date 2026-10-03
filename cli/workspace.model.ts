export interface Artifact {
  path: string;
  title: string;
  content: string;
  format: 'markdown' | 'yaml';
  modified: string | null;
  revision: string;
  completed: number;
  total: number;
  requirements: number;
  scenarios: number;
  summary: string;
  /** Number of the pull request the document was read from. */
  pullRequest?: number;
}
/** What a delta spec does to one requirement. */
export interface RequirementChange {
  kind: 'added' | 'modified' | 'removed' | 'renamed';
  /** The new name after a rename. */
  name: string;
  previousName?: string;
  /** Markdown from the delta: the new requirement, the reason of a removal, empty for a rename. */
  text: string;
  /** Markdown of the requirement in the published spec, or null when it has none. */
  previous: string | null;
  /** 1-based lines of the block in the delta document. */
  line: number;
  endLine: number;
}
export interface SpecDelta {
  path: string;
  capability: string;
  /** Path of the published spec, or null for a new capability. */
  published: string | null;
  requirements: RequirementChange[];
}
export interface ReviewComment {
  author: string;
  body: string;
  createdAt: string;
  url: string;
}
export interface ReviewThread {
  url: string;
  path: string;
  line: number | null;
  /** Name of the requirement change the thread is pinned to. */
  requirement: string | null;
  resolved: boolean;
  outdated: boolean;
  comments: ReviewComment[];
  /** Comments on GitHub beyond the ones included. */
  omitted: number;
}
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  branch: string;
  commit: string;
  updatedAt: string;
  changes: string[];
  threads: ReviewThread[];
}
/** A pull request as read from GitHub or the sample data; paths are relative to the openspec folder. */
export interface PullRequestInput extends Omit<PullRequest, 'changes' | 'threads'> {
  files: ArtifactFile[];
  threads: Omit<ReviewThread, 'requirement'>[];
}
export interface Change {
  id: string;
  name: string;
  title: string;
  archived: boolean;
  schema: string;
  status: 'Draft' | 'Planned' | 'In progress' | 'Complete';
  completed: number;
  total: number;
  summary: string;
  modified: string | null;
  documents: string[];
  /** Empty for archived changes: the text they replaced is gone. */
  deltas: SpecDelta[];
  pullRequest?: number;
}
export interface Workspace {
  name: string;
  root: string;
  isDemo: boolean;
  source?: {
    provider: 'github';
    repository: string;
    ref: string;
    commit: string;
    committedAt: string | null;
    folder: string;
    url: string;
  };
  schema: string;
  loadedAt: string;
  documents: Artifact[];
  changes: Change[];
  warnings: string[];
  specs: { path: string; capability: string; requirements: number; scenarios: number }[];
  /** Absent when pull requests were not read. */
  pullRequests?: PullRequest[];
}
/** A file read from the openspec folder. `modified` is epoch milliseconds, or null when unknown. */
export interface ArtifactFile {
  path: string;
  content: string;
  modified: number | null;
}
