import { artifactsOf } from './artifact.ts';
import {
  changesOf,
  mergedChanges,
  newestFirst,
  type ChangeContext,
  type ChangeSet,
} from './change.ts';
import { workspaceSettings } from '../formats/configuration.ts';
import { pullRequestOf, pullRequestPrefix } from './pull-request.ts';
import { publishedSpecs } from './spec-delta.ts';
import type { Artifact, ArtifactFile, PullRequest, PullRequestInput, Workspace } from './model.ts';

export interface BuildOptions {
  name: string;
  root: string;
  isDemo?: boolean;
  source?: Workspace['source'];
  /** Open pull requests to show next to the files; leave out when they were not read. */
  pullRequests?: PullRequestInput[];
  warnings?: string[];
  now?: Date;
}
/** A pull request kept in the workspace, with its artifacts and the changes they group into. */
interface KeptPullRequest extends ChangeSet {
  documents: Artifact[];
  pullRequest: PullRequest;
}

/** The pull requests that touch a change folder; the others are left out, with their documents. */
function keptPullRequests(pulls: PullRequestInput[], context: ChangeContext): KeptPullRequest[] {
  return pulls.flatMap((pull) => {
    const documents = artifactsOf(pull.files, pullRequestPrefix(pull.number), pull.number);
    const found = changesOf(documents, context, pull);
    if (!found.changes.length) return [];
    return [{ ...found, documents, pullRequest: pullRequestOf(pull, found.changes) }];
  });
}

/** The published specs on disk, with their requirement and scenario counts. */
function specsOf(documents: Artifact[]): Workspace['specs'] {
  return documents
    .filter((doc) => doc.path.startsWith('specs/') && doc.path.endsWith('/spec.md'))
    .map((doc) => ({
      path: doc.path,
      capability: doc.path.slice('specs/'.length, -'/spec.md'.length),
      requirements: doc.requirements,
      scenarios: doc.scenarios,
    }));
}

export function buildWorkspace(files: ArtifactFile[], options: BuildOptions): Workspace {
  // Artifacts: the files on disk, sorted by path.
  const fromDisk = artifactsOf(files);

  // Settings: the workspace schema from config.yaml, with the warnings it raises.
  const settings = workspaceSettings(fromDisk);

  // What every change shares: the workspace schema, the file times, and the published specs its
  // deltas are compared against.
  const context: ChangeContext = {
    schema: settings.schema,
    modified: new Map(files.map((file) => [file.path, file.modified])),
    published: publishedSpecs(fromDisk),
  };

  // Changes: from disk first.
  const disk = changesOf(fromDisk, context);

  // Pull requests: those that touch a change folder, each with its artifacts and changes.
  const pulls = keptPullRequests(options.pullRequests ?? [], context);
  const merged = mergedChanges([disk, ...pulls]);

  // Ordering: newest first; changes without a date come last.
  const changes = newestFirst(merged.changes, merged.times);

  // Assembly.
  const documents = [...fromDisk, ...pulls.flatMap((pull) => pull.documents)];
  return {
    name: options.name,
    root: options.root,
    isDemo: options.isDemo ?? false,
    ...(options.source ? { source: options.source } : {}),
    schema: settings.schema,
    loadedAt: (options.now ?? new Date()).toISOString(),
    documents,
    changes,
    warnings: [...(options.warnings ?? []), ...settings.warnings, ...merged.warnings],
    specs: specsOf(documents),
    ...(options.pullRequests ? { pullRequests: pulls.map((pull) => pull.pullRequest) } : {}),
  };
}
