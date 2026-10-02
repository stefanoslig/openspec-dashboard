import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Change } from '../../core/workspace.model';

@Component({
  selector: 'app-change-card',
  imports: [RouterLink, DatePipe],
  templateUrl: './change-card.html',
  styleUrl: './change-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeCard {
  readonly change = input.required<Change>();
  protected readonly firstDocument = computed(
    () =>
      this.change().documents.find((path) => !path.endsWith('.yaml')) ?? this.change().documents[0],
  );
  protected readonly count = computed(
    () => this.change().documents.filter((path) => path.endsWith('.md')).length,
  );
}
