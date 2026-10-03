import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Artifact, Change } from '../../../../cli/workspace.model';
import { hasPage } from '../../core/workspace-store';

export interface OutlineEntry {
  path: string;
  label: string;
  note?: string;
}
export interface OutlineGroup {
  title: string;
  entries: OutlineEntry[];
}

/** The documents of a change, grouped the way the outline lists them. */
export function outlineOf(change: Change, documents: Artifact[]): OutlineGroup[] {
  const byPath = new Map(documents.map((doc) => [doc.path, doc]));
  const files: OutlineEntry[] = [];
  const deltas: OutlineEntry[] = [];
  const others: OutlineEntry[] = [];
  for (const path of change.documents) {
    const doc = byPath.get(path);
    if (!doc) continue;
    const relative = path.slice(change.id.length + 1);
    const spec = /^specs\/(.+)\/spec\.md$/.exec(relative);
    if (spec) deltas.push({ path, label: spec[1] });
    else if (doc.format === 'yaml') others.push({ path, label: relative });
    else
      files.push({
        path,
        label: doc.title,
        ...(doc.total ? { note: doc.completed + ' / ' + doc.total } : {}),
      });
  }
  return [
    { title: 'In this change', entries: files },
    { title: 'Spec changes', entries: deltas },
    { title: 'Other files', entries: others },
  ].filter((group) => group.entries.length);
}

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
