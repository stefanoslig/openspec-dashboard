import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { WorkspaceStore } from './core/workspace-store';
import { Icon } from './shared/icon/icon';
import { WorkspaceNavigation } from './shared/workspace-navigation/workspace-navigation';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, WorkspaceNavigation, Icon],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'shortcut($event)' },
})
export class App {
  protected readonly store = inject(WorkspaceStore);
  readonly #router = inject(Router);
  private readonly searchBox = viewChild.required<ElementRef<HTMLInputElement>>('searchBox');
  constructor() {
    // Anchors stop below the sticky top bar; matches scroll-margin-top in styles.css.
    inject(ViewportScroller).setOffset([0, 84]);
  }
  protected search(event: Event): void {
    this.store.query.set((event.target as HTMLInputElement).value);
    if (this.#router.url.startsWith('/artifact')) void this.#router.navigate(['/']);
  }
  protected clearSearch(): void {
    this.store.query.set('');
    this.searchBox().nativeElement.focus();
  }
  /** "/" jumps to the search box, Escape empties it. */
  protected shortcut(event: KeyboardEvent): void {
    const box = this.searchBox().nativeElement;
    if (event.key === 'Escape' && event.target === box) {
      this.store.query.set('');
      box.blur();
    } else if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !(event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
    ) {
      event.preventDefault();
      box.focus();
    }
  }
  // With hash routing, following the #main link would be read as a route.
  protected skipToContent(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }
}
