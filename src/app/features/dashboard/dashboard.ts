import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, I18nPluralPipe } from '@angular/common';
import { excerpt } from '../../core/excerpt';
import { WorkspaceStore } from '../../core/workspace-store';
import { ChangeCard } from '../../shared/change-card/change-card';
import { Icon } from '../../shared/icon/icon';

/** The sections each view shows, in the order of the page. */
const sections: Record<string, string[]> = {
  overview: ['metrics', 'review', 'changes', 'specs'],
  changes: ['review', 'changes'],
  specs: ['specs'],
  archive: ['changes'],
  artifacts: ['artifacts'],
};
/** The wording of the changes section, for the archive and for the active changes. */
const changesWording = {
  archive: {
    heading: 'Archived changes',
    empty: 'No archived changes yet',
    hint: 'Archived changes will appear here with their original artifacts.',
  },
  active: {
    heading: 'Active changes',
    empty: 'A fresh start',
    hint: 'Changes from openspec/changes will appear here as you create them.',
  },
};

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ChangeCard, DatePipe, I18nPluralPipe, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected readonly store = inject(WorkspaceStore);
  readonly #params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly view = computed(() => this.#params()?.get('view') ?? 'overview');
  protected readonly shows = computed(() => new Set(sections[this.view()] ?? []));
  /** The search, which takes the place of the view while there is one. */
  protected readonly query = computed(() => this.store.query().trim());
  readonly #archive = computed(() => this.view() === 'archive');
  protected readonly changes = computed(() =>
    this.#archive() ? this.store.archived() : this.store.active(),
  );
  protected readonly wording = computed(() =>
    this.#archive() ? changesWording.archive : changesWording.active,
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
  protected readonly description = computed(
    () =>
      ({
        changes:
          'Work that is proposed or under way. Each change carries its proposal, design, tasks, and the spec updates it will make.',
        specs: 'The agreed behaviour of the system, one capability at a time.',
        archive: 'Finished changes, kept with their original documents.',
        artifacts: 'Every Markdown and YAML file in the openspec folder.',
      })[this.view()] ?? 'Ideas, decisions, and the details that bring them together.',
  );
  protected readonly progress = computed(() =>
    this.store.taskCount()
      ? Math.round((this.store.completedCount() / this.store.taskCount()) * 100)
      : 0,
  );
  protected readonly specs = computed(() => {
    const documents = new Map(this.store.workspace()?.documents.map((doc) => [doc.path, doc]));
    return (this.store.workspace()?.specs ?? []).map((spec) => ({
      ...spec,
      summary: documents.get(spec.path)?.summary ?? '',
    }));
  });
  protected readonly results = computed(() => {
    const terms = this.query().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (this.store.workspace()?.documents ?? [])
      .filter((doc) => {
        const haystack = (this.store.repositoryPath(doc) + ' ' + doc.content).toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .map((doc) => ({ doc, excerpt: excerpt(doc.content, terms) }));
  });
  protected readonly requirements = { '=1': '1 requirement', other: '# requirements' };
  protected readonly scenarios = { '=1': '1 scenario', other: '# scenarios' };
  protected readonly matches = { '=1': '1 document', other: '# documents' };
}
