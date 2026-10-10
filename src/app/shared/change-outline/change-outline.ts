import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Change } from '../../../../cli/workspace/model';
import type { OutlineGroup } from '../../core/workspace/outline';
import { hasPage } from '../../core/workspace/workspace-store';

@Component({
  selector: 'app-change-outline',
  imports: [RouterLink],
  templateUrl: './change-outline.html',
  styleUrl: './change-outline.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'complementary', 'aria-label': 'Related artifacts' },
})
export class ChangeOutline {
  readonly groups = input.required<OutlineGroup[]>();
  /** The change the documents belong to, for its progress. */
  readonly change = input<Change>();
  /** Path of the document being read, or the id of the change on its behaviour changes page. */
  readonly selected = input('');
  readonly opened = output<void>();
  /** Id of the change when it has a behaviour changes page. */
  protected readonly page = computed(() => {
    const change = this.change();
    return change && hasPage(change) ? change.id : '';
  });
}
