import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import type { Change } from '../../../../cli/workspace/model';
import { hasPage, kindCounts, WorkspaceStore } from '../../core/workspace/workspace-store';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-change-card',
  imports: [RouterLink, DatePipe, Icon],
  templateUrl: './change-card.html',
  styleUrl: './change-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeCard {
  readonly #store = inject(WorkspaceStore);
  readonly change = input.required<Change>();
  protected readonly firstDocument = computed(
    () =>
      this.change().documents.find((path) => !path.endsWith('.yaml')) ?? this.change().documents[0],
  );
  protected readonly count = computed(
    () => this.change().documents.filter((path) => path.endsWith('.md')).length,
  );
  protected readonly page = computed(() => hasPage(this.change()));
  protected readonly kinds = computed(() => kindCounts(this.change()));
  protected readonly pull = computed(() => this.#store.pullRequestOf(this.change()));
  protected readonly review = computed(() => this.#store.reviewOf(this.change()));
}
