import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { WorkspaceStore } from '../../core/workspace-store';
import { Icon, type IconName } from '../icon/icon';
@Component({
  selector: 'app-workspace-navigation',
  imports: [RouterLink, RouterLinkActive, Icon],
  templateUrl: './workspace-navigation.html',
  styleUrl: './workspace-navigation.css',
})
export class WorkspaceNavigation {
  protected readonly store = inject(WorkspaceStore);
  protected readonly navigation: { label: string; view: string; icon: IconName }[] = [
    { label: 'Overview', view: 'overview', icon: 'overview' },
    { label: 'Changes', view: 'changes', icon: 'change' },
    { label: 'Specifications', view: 'specs', icon: 'spec' },
    { label: 'Archive', view: 'archive', icon: 'archive' },
    { label: 'All artifacts', view: 'artifacts', icon: 'list' },
  ];
  protected count(view: string): number | undefined {
    return {
      changes: this.store.active().length + this.store.inReview().length,
      specs: this.store.workspace()?.specs.length,
      archive: this.store.archived().length,
    }[view];
  }
}
