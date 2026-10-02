import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { WorkspaceStore } from './core/workspace-store';
import { WorkspaceNavigation } from './shared/workspace-navigation/workspace-navigation';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, WorkspaceNavigation],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(WorkspaceStore);
  readonly #router = inject(Router);
  protected search(event: Event): void {
    this.store.query.set((event.target as HTMLInputElement).value);
    if (this.#router.url.startsWith('/artifact')) void this.#router.navigate(['/']);
  }
  // With hash routing, following the #main link would be read as a route.
  protected skipToContent(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }
}
