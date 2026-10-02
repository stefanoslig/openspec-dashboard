import { computed, Service, signal } from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import type { Workspace } from '../../../cli/workspace.model';

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
  readonly active = computed(
    () => this.workspace()?.changes.filter((change) => !change.archived) ?? [],
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
  sourceLink(path: string): string {
    const source = this.workspace()?.source;
    return source
      ? `${source.url}/blob/${source.commit}/${(source.folder + '/' + path).split('/').map(encodeURIComponent).join('/')}`
      : '';
  }
}
