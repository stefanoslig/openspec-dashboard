import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { WorkspaceStore } from '../../core/workspace-store';
@Component({
  selector: 'app-workspace-navigation',
  imports: [RouterLink],
  templateUrl: './workspace-navigation.html',
  styleUrl: './workspace-navigation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceNavigation {
  protected readonly store = inject(WorkspaceStore);
  protected readonly router = inject(Router);
  readonly #currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly navigation = [
    { label: 'Overview', view: 'overview', icon: '◫' },
    { label: 'Changes', view: 'changes', icon: '◇' },
    { label: 'Specifications', view: 'specs', icon: '▤' },
    { label: 'Archive', view: 'archive', icon: '▱' },
    { label: 'All artifacts', view: 'artifacts', icon: '≡' },
  ];
  protected isActive(view: string): boolean {
    return (
      !this.#currentUrl().startsWith('/artifact') &&
      (this.router.parseUrl(this.#currentUrl()).queryParams['view'] ?? 'overview') === view
    );
  }
}
