import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WorkspaceStore } from '../../core/workspace-store';
import { renderMarkdown } from '../../core/render-markdown';

@Component({
  selector: 'app-reader',
  imports: [RouterLink, DatePipe],
  templateUrl: './reader.html',
  styleUrl: './reader.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reader {
  protected readonly store = inject(WorkspaceStore);
  readonly #router = inject(Router);
  readonly #params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly document = computed(() =>
    this.store.workspace()?.documents.find((doc) => doc.path === this.#params()?.get('path')),
  );
  protected readonly change = computed(() =>
    this.store
      .workspace()
      ?.changes.find((change) => change.documents.includes(this.document()?.path ?? '')),
  );
  protected readonly siblings = computed(() => {
    const change = this.change();
    const documents = this.store.workspace()?.documents ?? [];
    if (!change) return documents.filter((doc) => doc.path.startsWith('specs/'));
    const byPath = new Map(documents.map((doc) => [doc.path, doc]));
    return change.documents.map((path) => byPath.get(path)).filter((doc) => doc !== undefined);
  });
  protected readonly rendered = computed(() =>
    renderMarkdown(this.document()?.format === 'markdown' ? (this.document()?.content ?? '') : ''),
  );
  protected readonly showSource = signal(false);
  protected readonly linkWarning = signal('');
  protected readonly backView = computed(() =>
    this.change()?.archived ? 'archive' : this.change() ? 'changes' : 'artifacts',
  );
  protected label(path: string): string {
    return this.change() ? path.slice(this.change()!.id.length + 1) : path.replace(/^specs\//, '');
  }
  protected scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
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
        this.scrollTo(decodeURIComponent(href.slice(1)));
        return;
      }
      const resolved = new URL(href, 'https://workspace.local/openspec/' + this.document()!.path);
      if (resolved.origin !== 'https://workspace.local') return;
      const path = decodeURIComponent(resolved.pathname.replace(/^\/openspec\//, ''));
      if (!this.store.workspace()?.documents.some((doc) => doc.path === path)) {
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
