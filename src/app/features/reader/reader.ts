import { Component, computed, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { DatePipe, I18nPluralPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { documentContext } from '../../core/document/document-context';
import { linkTarget, type LinkTarget } from '../../core/document/document-link';
import {
  capabilityOf,
  neighboursOf,
  outlineOf,
  outlineOfSpecs,
  outlineOfWorkspace,
} from '../../core/workspace/outline';
import { collapseOutline, pageOutline } from '../../core/document/page-outline';
import { readFlag, writeFlag } from '../../core/preference';
import { renderMarkdown } from '../../core/document/render-markdown';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { ChangeOutline } from '../../shared/change-outline/change-outline';
import { Icon } from '../../shared/icon/icon';
import { ScrollSpy } from './scroll-spy';

// Where the "Hide completed" choice is kept between visits.
const hideDoneKey = 'openspec-desk.hide-done';

/** What the reader is told about a link that cannot be followed; nothing for one that can. */
function warningFor(target: LinkTarget, href: string): string {
  if (target.kind === 'missing')
    return 'This link points outside the loaded OpenSpec artifacts: ' + href;
  if (target.kind === 'broken') return 'This document contains a link that could not be opened.';
  return '';
}

@Component({
  selector: 'app-reader',
  imports: [RouterLink, DatePipe, I18nPluralPipe, ChangeOutline, Icon, ScrollSpy],
  templateUrl: './reader.html',
  styleUrl: './reader.css',
})
export class Reader {
  // Dependencies
  protected readonly store = inject(WorkspaceStore);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);

  // Route signals: the document asked for, and the heading linked to
  readonly #params = toSignal(this.#route.queryParamMap);
  readonly #fragment = toSignal(this.#route.fragment);
  readonly #requestedPath = computed(() => this.#params()?.get('path'));
  /**
   * The heading to scroll to, until the page has reached it. Re-armed by a new fragment, or the
   * same one in another document; cleared by the directive's (reached).
   */
  protected readonly linkedHeading = linkedSignal({
    source: () => ({ path: this.#requestedPath(), fragment: this.#fragment() }),
    computation: (route) => route.fragment ?? '',
  });

  // The document and its context
  protected readonly document = computed(() =>
    this.store.workspace()?.documents.find((doc) => doc.path === this.#requestedPath()),
  );
  /** Path of the document being read; empty until it is found. */
  readonly #path = computed(() => this.document()?.path ?? '');
  protected readonly change = computed(() =>
    this.store.workspace()?.changes.find((change) => change.documents.includes(this.#path())),
  );
  /** The pull request the document was read from. */
  protected readonly pull = computed(() => {
    const doc = this.document();
    return doc && this.store.pullRequestOf(doc);
  });
  /** Capability name when the document is a published specification. */
  protected readonly capability = computed(() => capabilityOf(this.#path()));
  /** The eyebrow above the title, and the way back to the listing the document came from. */
  protected readonly context = computed(() =>
    documentContext({
      change: this.change(),
      inReview: this.pull() !== undefined,
      capability: this.capability(),
    }),
  );

  // Sidebar and pager
  protected readonly groups = computed(() => {
    const change = this.change();
    const documents = this.store.workspace()?.documents ?? [];
    if (change) return outlineOf(change, documents);
    return this.capability() === undefined
      ? outlineOfWorkspace(documents)
      : outlineOfSpecs(documents);
  });
  protected readonly neighbours = computed(() => neighboursOf(this.groups(), this.#path()));

  // Content and outline
  protected readonly rendered = computed(() => {
    const doc = this.document();
    return renderMarkdown(doc?.format === 'markdown' ? doc.content : '');
  });
  readonly #headings = computed(() => pageOutline(this.rendered().headings));
  /**
   * Follows the reader through the rendered headings; absent while the source is shown. Not a
   * #field: the compiler reads a signal query by name.
   */
  private readonly scrollSpy = viewChild(ScrollSpy);
  /** Id of the heading being read. */
  protected readonly active = signal('');
  /** Id of the heading last asked for, by a click or a link; the end of the page keeps it active. */
  protected readonly requestedHeading = signal('');
  /** "On this page", collapsed to the requirement being read when the document is long. */
  protected readonly outline = computed(() => collapseOutline(this.#headings(), this.active()));

  // View state
  protected readonly showSource = signal(false);
  protected readonly linkWarning = signal('');
  protected readonly hideDone = signal(readFlag(hideDoneKey));
  protected readonly requirements = { '=1': '1 requirement', other: '# requirements' };
  protected readonly scenarios = { '=1': '1 scenario', other: '# scenarios' };

  // Handlers
  /** Leaves the link warning and the Source view behind when moving to another document. */
  protected resetView(): void {
    this.linkWarning.set('');
    this.showSource.set(false);
  }
  protected toggleDone(): void {
    this.hideDone.update((hidden) => !hidden);
    writeFlag(hideDoneKey, this.hideDone());
  }
  protected scrollTo(id: string): void {
    this.requestedHeading.set(id);
    this.scrollSpy()?.scrollTo(id);
  }
  /** The linked heading has been reached: it is the one asked for now, and no later render scrolls again. */
  protected headingReached(): void {
    this.requestedHeading.set(this.linkedHeading());
    this.linkedHeading.set('');
  }
  /** Opens a link of the document inside the dashboard; links to the web are left to the browser. */
  protected followLink(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    const paths = this.store.workspace()?.documents.map((doc) => doc.path) ?? [];
    const target = linkTarget(href, this.#path(), paths);
    if (target.kind === 'web') return;
    event.preventDefault();
    this.linkWarning.set(warningFor(target, href));
    if (target.kind === 'heading') this.#showHeading(target.fragment);
    if (target.kind === 'document') this.#showDocument(target.path, target.fragment);
  }
  #showHeading(fragment: string): void {
    this.scrollTo(fragment);
    // Keeps the address bar pointing at the heading, so it can be copied and shared.
    void this.#router.navigate(['/artifact'], { fragment });
  }
  #showDocument(path: string, fragment: string): void {
    this.resetView();
    void this.#router.navigate(['/artifact'], { queryParams: { path }, fragment });
  }
}
