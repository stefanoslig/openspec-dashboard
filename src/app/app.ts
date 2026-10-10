import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { WorkspaceStore } from './core/workspace/workspace-store';
import { Icon } from './shared/icon/icon';
import { WorkspaceNavigation } from './shared/workspace-navigation/workspace-navigation';
type Theme = 'light' | 'dark';
const THEME_KEY = 'openspec-desk.theme';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, WorkspaceNavigation, Icon],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '(document:keydown)': 'shortcut($event)' },
})
export class App {
  protected readonly store = inject(WorkspaceStore);
  readonly #router = inject(Router);
  private readonly searchBox = viewChild.required<ElementRef<HTMLInputElement>>('searchBox');
  protected readonly theme = signal<Theme>(this.#preferredTheme());
  constructor() {
    // Anchors stop below the sticky top bar; matches scroll-margin-top in styles.css.
    inject(ViewportScroller).setOffset([0, 76]);
  }
  protected search(event: Event): void {
    this.store.query.set((event.target as HTMLInputElement).value);
    if (/^\/(artifact|change)/.test(this.#router.url)) void this.#router.navigate(['/']);
  }
  protected clearSearch(): void {
    this.store.query.set('');
    this.searchBox().nativeElement.focus();
  }
  protected toggleTheme(): void {
    const theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(theme);
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private windows may refuse storage; the choice then lasts for the session.
    }
  }
  // Saved choice first, else the OS setting. index.html applies the saved one before paint.
  #preferredTheme(): Theme {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // Private windows may refuse storage.
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
