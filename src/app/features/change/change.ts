import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { RequirementChange } from '../../../../cli/workspace.model';
import { commentLink } from '../../core/comment-link';
import { renderMarkdown } from '../../core/render-markdown';
import { diffRequirement } from '../../core/requirement-diff';
import { kindCounts, WorkspaceStore } from '../../core/workspace-store';
import { ChangeOutline, outlineOf } from '../../shared/change-outline/change-outline';
import { Icon } from '../../shared/icon/icon';
import { ReviewThreadView } from '../../shared/review-thread/review-thread';

const html = (markdown: string) =>
  renderMarkdown(markdown, { requirement: true, standalone: true }).html;
/** A requirement block without its heading line. */
const body = (block: string) => block.slice(block.indexOf('\n') + 1 || block.length);

/** A requirement change with everything the template shows worked out. */
function view(change: RequirementChange) {
  const { kind, previous } = change;
  const parts =
    kind === 'modified' && previous !== null
      ? diffRequirement(previous, change.text).map((part) => ({
          ...part,
          html: part.kind === 'changed' ? '' : html(part.markdown),
        }))
      : [];
  return {
    ...change,
    parts,
    identical: kind === 'modified' && previous !== null && parts.every((p) => p.kind === 'same'),
    // The published spec lacks what the delta changes, or already has what it adds.
    missing: kind !== 'added' && previous === null,
    exists: kind === 'added' && previous !== null,
    // The new text, or the reason of a removal.
    html: html(kind === 'removed' ? change.text : body(change.text)),
    previousHtml: kind === 'removed' && previous !== null ? html(body(previous)) : '',
  };
}

@Component({
  selector: 'app-change-page',
  imports: [DatePipe, RouterLink, ChangeOutline, Icon, ReviewThreadView],
  templateUrl: './change.html',
  styleUrls: ['../reader/reader.css', './change.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePage {
  protected readonly store = inject(WorkspaceStore);
  readonly #params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly change = computed(() =>
    this.store.workspace()?.changes.find((change) => change.id === this.#params()?.get('id')),
  );
  protected readonly groups = computed(() => {
    const change = this.change();
    return change ? outlineOf(change, this.store.workspace()?.documents ?? []) : [];
  });
  protected readonly pull = computed(() => {
    const change = this.change();
    return change && this.store.pullRequestOf(change);
  });
  protected readonly review = computed(() => {
    const change = this.change();
    return change ? this.store.reviewOf(change) : { open: 0, label: '' };
  });
  readonly #threads = computed(() => {
    const change = this.change();
    return change ? this.store.threadsOf(change) : [];
  });
  protected readonly deltas = computed(() => {
    const change = this.change();
    const pull = this.pull();
    return (change?.deltas ?? []).map((delta) => ({
      ...delta,
      // The document as GitHub lists it among the files of the pull request.
      file: [
        this.store.workspace()?.source?.folder,
        this.store.repositoryPath({ path: delta.path, pullRequest: change?.pullRequest }),
      ]
        .filter(Boolean)
        .join('/'),
      requirements: delta.requirements.map((requirement) => ({
        ...view(requirement),
        comment: pull && commentLink(pull, delta.path, requirement),
        threads: this.#threads().filter(
          (thread) =>
            thread.path === delta.path &&
            thread.requirement !== null &&
            thread.line !== null &&
            requirement.line <= thread.line &&
            thread.line <= requirement.endLine,
        ),
      })),
    }));
  });
  /** The threads that belong to no requirement, each with its document and line. */
  protected readonly discussion = computed(() => {
    const change = this.change();
    const labels = new Map(
      this.groups().flatMap((group) => group.entries.map((entry) => [entry.path, entry.label])),
    );
    const order = [...labels.keys()];
    return this.#threads()
      .filter((thread) => thread.requirement === null)
      .sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path))
      .map((thread) => ({
        thread,
        place:
          (labels.get(thread.path) ?? thread.path.slice((change?.id.length ?? 0) + 1)) +
          (thread.line === null ? '' : ' · line ' + thread.line),
      }));
  });
  protected readonly counts = computed(() => {
    const change = this.change();
    return change ? kindCounts(change) : [];
  });
}
