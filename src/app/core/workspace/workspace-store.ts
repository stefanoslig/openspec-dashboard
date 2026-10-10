import { computed, Service, signal } from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import type {
  Artifact,
  Change,
  PullRequest,
  ReviewThread,
  Workspace,
} from '../../../../cli/workspace/model';

/** Whether a change has a behaviour changes page: it changes requirements or is in review. */
export const hasPage = (change: Change) =>
  change.deltas.length > 0 || change.pullRequest !== undefined;

/** How many requirements a change adds, modifies, removes and renames; kinds without any are left out. */
export function kindCounts(change: Change): { kind: string; count: number }[] {
  const all = change.deltas.flatMap((delta) => delta.requirements);
  return (['added', 'modified', 'removed', 'renamed'] as const)
    .map((kind) => ({ kind, count: all.filter((item) => item.kind === kind).length }))
    .filter(({ count }) => count);
}

function message(error: unknown): string {
  if (!error) return '';
  return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
    ? error.error.error
    : 'Could not load the workspace. Try again shortly.';
}

@Service()
export class WorkspaceStore {
  readonly query = signal('');
  // Relative, so a site published under any path finds the file next to index.html.
  readonly resource = httpResource<Workspace>(() => 'workspace.json');
  readonly workspace = computed(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  /** The changes of the workspace itself that are not archived. */
  readonly active = computed(
    () =>
      this.workspace()?.changes.filter(
        (change) => !change.archived && change.pullRequest === undefined,
      ) ?? [],
  );
  /** The changes read from open pull requests. */
  readonly inReview = computed(
    () => this.workspace()?.changes.filter((change) => change.pullRequest !== undefined) ?? [],
  );
  readonly archived = computed(
    () => this.workspace()?.changes.filter((change) => change.archived) ?? [],
  );
  readonly taskCount = computed(() =>
    this.active().reduce((count, change) => count + change.total, 0),
  );
  readonly completedCount = computed(() =>
    this.active().reduce((count, change) => count + change.completed, 0),
  );
  readonly error = computed(() => message(this.resource.error()));
  /** The pull request a change or a document was read from. */
  pullRequestOf(item: { pullRequest?: number }): PullRequest | undefined {
    return this.workspace()?.pullRequests?.find((pull) => pull.number === item.pullRequest);
  }
  /** The review threads on the documents of a change. */
  threadsOf(change: Change): ReviewThread[] {
    return (
      this.pullRequestOf(change)?.threads.filter((thread) =>
        change.documents.includes(thread.path),
      ) ?? []
    );
  }
  /** Review status of a change: its unresolved threads, in words; empty when it has no threads. */
  reviewOf(change: Change): { open: number; label: string } {
    const threads = this.threadsOf(change);
    const open = threads.filter((thread) => !thread.resolved).length;
    return {
      open,
      label: open
        ? open + (open === 1 ? ' open thread' : ' open threads')
        : threads.length
          ? 'All threads resolved'
          : '',
    };
  }
  /** A document's path in the repository: pull request documents carry a prefix in the workspace. */
  repositoryPath(doc: Pick<Artifact, 'path' | 'pullRequest'>): string {
    return doc.pullRequest === undefined
      ? doc.path
      : doc.path.slice(`.pulls/${doc.pullRequest}/`.length);
  }
  /** The file on GitHub, at the published commit or at the head of its pull request. */
  sourceLink(doc: Pick<Artifact, 'path' | 'pullRequest'>): string {
    const source = this.workspace()?.source;
    const commit = this.pullRequestOf(doc)?.commit ?? source?.commit;
    return source
      ? `${source.url}/blob/${commit}/${(source.folder + '/' + this.repositoryPath(doc)).split('/').map(encodeURIComponent).join('/')}`
      : '';
  }
}
