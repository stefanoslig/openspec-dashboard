import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { WorkspaceStore } from '../../core/workspace-store';
import { ChangeCard } from '../../shared/change-card/change-card';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ChangeCard, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly store = inject(WorkspaceStore);
  readonly #params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly view = computed(() => this.#params()?.get('view') ?? 'overview');
  protected readonly changes = computed(() =>
    this.view() === 'archive' ? this.store.archived() : this.store.active(),
  );
  // An exported site carries no file times, so there is no recency to sort by.
  protected readonly dated = computed(() => this.changes().some((change) => change.modified));
  protected readonly title = computed(
    () =>
      ({
        overview: 'A clearer view of what’s next.',
        changes: 'From an idea to a finished change.',
        specs: 'Your system, written down.',
        archive: 'A record of the work.',
        artifacts: 'Every document. One place.',
      })[this.view()] ?? 'Your workspace.',
  );
  protected readonly progress = computed(() =>
    this.store.taskCount()
      ? Math.round((this.store.completedCount() / this.store.taskCount()) * 100)
      : 0,
  );
  protected readonly results = computed(() => {
    const terms = this.store.query().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (this.store.workspace()?.documents ?? []).filter((doc) => {
      const haystack = (doc.path + ' ' + doc.content).toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  });
}
