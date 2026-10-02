import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { WorkspaceStore } from '../../core/workspace-store';
import { Icon, type IconName } from '../icon/icon';
@Component({
  selector: 'app-workspace-navigation',
  imports: [RouterLink, Icon],
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
  protected readonly navigation: { label: string; view: string; icon: IconName }[] = [
    { label: 'Overview', view: 'overview', icon: 'overview' },
    { label: 'Changes', view: 'changes', icon: 'change' },
    { label: 'Specifications', view: 'specs', icon: 'spec' },
    { label: 'Archive', view: 'archive', icon: 'archive' },
    { label: 'All artifacts', view: 'artifacts', icon: 'list' },
  ];
  protected count(view: string): number | undefined {
    return {
      changes: this.store.active().length,
      specs: this.store.workspace()?.specs.length,
      archive: this.store.archived().length,
    }[view];
  }
  protected isActive(view: string): boolean {
    return (
      !this.#currentUrl().startsWith('/artifact') &&
      (this.router.parseUrl(this.#currentUrl()).queryParams['view'] ?? 'overview') === view
    );
  }
}
