import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, I18nPluralPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { linkedDocument } from '../../core/document-link';
import { capabilityOf, outlineOf, outlineOfSpecs, outlineOfWorkspace } from '../../core/outline';
import { pageOutline } from '../../core/page-outline';
import { isWebLink, renderMarkdown } from '../../core/render-markdown';
import { WorkspaceStore } from '../../core/workspace-store';
import { ChangeOutline } from '../../shared/change-outline/change-outline';
import { Icon } from '../../shared/icon/icon';

// Where the "Hide completed" choice is kept between visits.
const hideDoneKey = 'openspec-desk.hide-done';
// Past this many headings, the outline shows scenarios only for the requirement being read.
const longOutline = 18;
// A heading above this line of the viewport, in pixels from its top, counts as read.
const line = 110;

type BackView = 'archive' | 'changes' | 'specs' | 'artifacts';
const backLabels: Record<BackView, string> = {
  archive: 'Archive',
  changes: 'All changes',
  specs: 'All specifications',
  artifacts: 'All artifacts',
};

/** The last heading above the line, or the first when none has reached it. */
function headingAtLine(headings: HTMLElement[]): HTMLElement | undefined {
  let current = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > line) break;
    current = heading;
  }
  return current;
}
// The last headings of a page cannot reach the line, so its end is a case of its own.
const atPageEnd = () =>
  scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2;

@Component({
  selector: 'app-reader',
  imports: [RouterLink, DatePipe, I18nPluralPipe, ChangeOutline, Icon],
  templateUrl: './reader.html',
  styleUrl: './reader.css',
})
export class Reader {
  protected readonly store = inject(WorkspaceStore);
  readonly #router = inject(Router);
  readonly #host: HTMLElement = inject(ElementRef).nativeElement;
  readonly #route = inject(ActivatedRoute);
  readonly #params = toSignal(this.#route.queryParamMap);
  readonly #fragment = toSignal(this.#route.fragment);
  protected readonly document = computed(() =>
    this.store.workspace()?.documents.find((doc) => doc.path === this.#params()?.get('path')),
  );
  protected readonly change = computed(() =>
    this.store
      .workspace()
      ?.changes.find((change) => change.documents.includes(this.document()?.path ?? '')),
  );
  /** The pull request the document was read from. */
  protected readonly pull = computed(() => {
    const doc = this.document();
    return doc && this.store.pullRequestOf(doc);
  });
  /** Capability name when the document is a published specification. */
  protected readonly capability = computed(() => capabilityOf(this.document()?.path ?? ''));
  /** What the document is part of, shown above its title. */
  protected readonly eyebrow = computed(() => {
    const change = this.change();
    if (change?.archived) return 'Archived change';
    if (this.pull()) return 'Change in review';
    if (change) return 'Active change';
    return this.capability() ? 'Specification' : 'Workspace artifact';
  });
  protected readonly groups = computed(() => {
    const change = this.change();
    const documents = this.store.workspace()?.documents ?? [];
    if (change) return outlineOf(change, documents);
    return this.capability() === undefined
      ? outlineOfWorkspace(documents)
      : outlineOfSpecs(documents);
  });
  readonly #neighbours = computed(() => {
    const entries = this.groups().flatMap((group) => group.entries);
    const index = entries.findIndex((entry) => entry.path === this.document()?.path);
    return { previous: entries[index - 1], next: index < 0 ? undefined : entries[index + 1] };
  });
  protected readonly previous = computed(() => this.#neighbours().previous);
  protected readonly next = computed(() => this.#neighbours().next);
  protected readonly rendered = computed(() =>
    renderMarkdown(this.document()?.format === 'markdown' ? (this.document()?.content ?? '') : ''),
  );
  readonly #outline = computed(() => pageOutline(this.rendered().headings));
  protected readonly active = signal('');
  protected readonly outline = computed(() => {
    const headings = this.#outline();
    if (headings.length <= longOutline) return headings;
    const current = headings.find((heading) => heading.id === this.active());
    const open = current?.parent || current?.id;
    return headings.filter((heading) => !heading.parent || heading.parent === open);
  });
  protected readonly showSource = signal(false);
  protected readonly linkWarning = signal('');
  protected readonly hideDone = signal(this.#stored());
  /** The listing the document came from. */
  protected readonly backView = computed((): BackView => {
    const change = this.change();
    if (change?.archived) return 'archive';
    if (change) return 'changes';
    return this.capability() === undefined ? 'artifacts' : 'specs';
  });
  protected readonly backLabel = computed(() => backLabels[this.backView()]);
  protected readonly requirements = { '=1': '1 requirement', other: '# requirements' };
  protected readonly scenarios = { '=1': '1 scenario', other: '# scenarios' };
  #arrived = '';
  #chosen = '';

  constructor() {
    const spy = () => this.#spy();
    window.addEventListener('scroll', spy, { passive: true });
    inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', spy));
    afterRenderEffect(() => {
      const path = this.document()?.path;
      const { headings } = this.rendered();
      this.showSource();
      // The sanitizer behind [innerHTML] drops id attributes, so the headings get theirs here.
      this.#headings().forEach((heading, index) => (heading.id = headings[index]?.id ?? ''));
      // A link to a heading arrives before the workspace has loaded; scroll once it is there.
      const fragment = untracked(this.#fragment);
      if (path && fragment && this.#arrived !== path + '#' + fragment) this.scrollTo(fragment);
      this.#arrived = path + '#' + fragment;
      this.#spy();
    });
  }

  #headings(): HTMLElement[] {
    return [...this.#host.querySelectorAll<HTMLElement>('.prose :is(h1,h2,h3,h4,h5,h6)')];
  }
  /** Marks the heading the reader has scrolled to. */
  #spy(): void {
    const headings = this.#headings();
    const current =
      headings.length && atPageEnd() ? this.#chosenOrLast(headings) : headingAtLine(headings);
    this.active.set(current?.id ?? '');
  }
  /** At the end of the page: the heading that was asked for while it is still below the line, else the last. */
  #chosenOrLast(headings: HTMLElement[]): HTMLElement {
    const chosen = headings.find((heading) => heading.id === this.#chosen);
    return chosen && chosen.getBoundingClientRect().top > line
      ? chosen
      : headings[headings.length - 1];
  }
  protected scrollTo(id: string): void {
    this.#chosen = id;
    document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  // Storage can be unavailable, for example with cookies blocked; the choice then lasts the visit.
  #stored(): boolean {
    try {
      return localStorage.getItem(hideDoneKey) === 'true';
    } catch {
      return false;
    }
  }
  protected toggleDone(): void {
    this.hideDone.update((hidden) => !hidden);
    try {
      localStorage.setItem(hideDoneKey, String(this.hideDone()));
    } catch {}
  }
  protected open(): void {
    this.linkWarning.set('');
    this.showSource.set(false);
  }
  /** Opens a link of the document inside the dashboard; links to the web are left to the browser. */
  protected followLink(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (isWebLink(href)) return;
    event.preventDefault();
    this.linkWarning.set('');
    try {
      this.#follow(href);
    } catch {
      this.linkWarning.set('This document contains a link that could not be opened.');
    }
  }
  #follow(href: string): void {
    if (href.startsWith('#')) this.#followHeading(decodeURIComponent(href.slice(1)));
    else this.#followDocument(href);
  }
  #followHeading(fragment: string): void {
    this.scrollTo(fragment);
    // Keeps the address bar pointing at the heading, so it can be copied and shared.
    void this.#router.navigate(['/artifact'], { fragment });
  }
  #followDocument(href: string): void {
    const paths = this.store.workspace()?.documents.map((doc) => doc.path) ?? [];
    const target = linkedDocument(href, this.document()!.path, paths);
    if (!target) return;
    if (!paths.includes(target.path)) {
      this.linkWarning.set('This link points outside the loaded OpenSpec artifacts: ' + href);
      return;
    }
    this.showSource.set(false);
    void this.#router.navigate(['/artifact'], {
      queryParams: { path: target.path },
      fragment: target.fragment,
    });
  }
}
