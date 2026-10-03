import {
  afterRenderEffect,
  ChangeDetectionStrategy,
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
import type { Artifact } from '../../../../cli/workspace.model';
import { WorkspaceStore } from '../../core/workspace-store';
import { renderMarkdown } from '../../core/render-markdown';
import {
  ChangeOutline,
  outlineOf,
  type OutlineGroup,
} from '../../shared/change-outline/change-outline';
import { Icon } from '../../shared/icon/icon';

// Where the "Hide completed" choice is kept between visits.
const hideDoneKey = 'openspec-desk.hide-done';
// Past this many headings, the outline shows scenarios only for the requirement being read.
const longOutline = 18;

@Component({
  selector: 'app-reader',
  imports: [RouterLink, DatePipe, I18nPluralPipe, ChangeOutline, Icon],
  templateUrl: './reader.html',
  styleUrl: './reader.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  protected readonly capability = computed(
    () => /^specs\/(.+)\/spec\.md$/.exec(this.document()?.path ?? '')?.[1],
  );
  protected readonly groups = computed((): OutlineGroup[] => {
    const change = this.change();
    const documents = this.store.workspace()?.documents ?? [];
    if (change) return outlineOf(change, documents);
    const specs = this.capability() !== undefined;
    return [
      {
        title: specs ? 'Specifications' : 'Workspace files',
        entries: documents
          .filter((doc) =>
            specs
              ? /^specs\/.+\/spec\.md$/.test(doc.path)
              : doc.pullRequest === undefined && !/^(specs|changes)\//.test(doc.path),
          )
          .map((doc) => ({
            path: doc.path,
            label: specs ? doc.path.slice('specs/'.length, -'/spec.md'.length) : doc.path,
          })),
      },
    ];
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
  /** Headings for "On this page": the document title is left out, scenarios know their requirement. */
  readonly #outline = computed(() => {
    const all = this.rendered().headings;
    const headings = all.filter((heading) => heading.depth === 1).length === 1 ? all.slice(1) : all;
    const top = Math.min(...headings.map((heading) => heading.depth));
    let requirement = '';
    return headings.map((heading) => {
      if (heading.kind !== 'scenario')
        requirement = heading.kind === 'requirement' ? heading.id : '';
      return {
        ...heading,
        text:
          heading.kind && heading.kind !== 'requirement' && heading.kind !== 'scenario'
            ? heading.kind.charAt(0).toUpperCase() +
              heading.kind.slice(1) +
              ' ' +
              heading.text.toLowerCase()
            : heading.text,
        level: Math.min(heading.depth - top, 2),
        parent: heading.kind === 'scenario' ? requirement : '',
      };
    });
  });
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
  protected readonly backView = computed(() =>
    this.change()?.archived
      ? 'archive'
      : this.change()
        ? 'changes'
        : this.capability() !== undefined
          ? 'specs'
          : 'artifacts',
  );
  protected readonly backLabel = computed(
    () =>
      ({ archive: 'Archive', changes: 'All changes', specs: 'All specifications' })[
        this.backView() as string
      ] ?? 'All artifacts',
  );
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
    const line = 110;
    let current = headings[0]?.id ?? '';
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > line) break;
      current = heading.id;
    }
    // The last headings cannot reach the line: at the end of the page, mark the one that was
    // asked for, or else the last.
    const page = document.documentElement;
    if (headings.length && scrollY > 0 && scrollY + innerHeight >= page.scrollHeight - 2) {
      const chosen = headings.find((heading) => heading.id === this.#chosen);
      const visible = chosen && chosen.getBoundingClientRect().top > line;
      current = visible ? chosen.id : headings[headings.length - 1].id;
    }
    this.active.set(current);
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
  protected followLink(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) return;
    event.preventDefault();
    this.linkWarning.set('');
    try {
      if (href.startsWith('#')) {
        const fragment = decodeURIComponent(href.slice(1));
        this.scrollTo(fragment);
        // Keeps the address bar pointing at the heading, so it can be copied and shared.
        void this.#router.navigate(['/artifact'], { fragment });
        return;
      }
      const resolved = new URL(href, 'https://workspace.local/openspec/' + this.document()!.path);
      if (resolved.origin !== 'https://workspace.local') return;
      let path = decodeURIComponent(resolved.pathname.replace(/^\/openspec\//, ''));
      const known = (candidate: string) =>
        this.store.workspace()?.documents.some((doc) => doc.path === candidate);
      // A pull request document may link to a document of the published branch.
      const prefix = /^\.pulls\/\d+\//.exec(path)?.[0] ?? '';
      if (!known(path) && known(path.slice(prefix.length))) path = path.slice(prefix.length);
      if (!known(path)) {
        this.linkWarning.set('This link points outside the loaded OpenSpec artifacts: ' + href);
        return;
      }
      this.showSource.set(false);
      void this.#router.navigate(['/artifact'], {
        queryParams: { path },
        fragment: decodeURIComponent(resolved.hash.slice(1)),
      });
    } catch {
      this.linkWarning.set('This document contains a link that could not be opened.');
    }
  }
}
