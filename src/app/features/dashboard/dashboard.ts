import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, I18nPluralPipe } from '@angular/common';
import { WorkspaceStore } from '../../core/workspace-store';
import { ChangeCard } from '../../shared/change-card/change-card';
import { Icon } from '../../shared/icon/icon';

/** The text around the first match, split so the matching words can be marked. */
function excerpt(content: string, terms: string[]): { text: string; hit: boolean }[] {
  const plain = content
    .replace(/^\s*[-*] \[[ x]\] /gim, '')
    .replace(/[#*`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = plain.toLocaleLowerCase();
  const at = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  if (!Number.isFinite(at)) return [];
  const start = at > 70 ? plain.indexOf(' ', at - 70) + 1 : 0;
  const end = at + 180;
  const pattern = new RegExp(
    '(' + terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'gi',
  );
  return ((start ? '… ' : '') + plain.slice(start, end) + (end < plain.length ? '…' : ''))
    .split(pattern)
    .filter(Boolean)
    .map((text) => ({ text, hit: terms.includes(text.toLocaleLowerCase()) }));
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ChangeCard, DatePipe, I18nPluralPipe, Icon],
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
    const terms = this.store.query().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
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
