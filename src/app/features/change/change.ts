import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { RequirementChange, ReviewThread } from '../../../../cli/workspace.model';
import { commentLink } from '../../core/comment-link';
import { outlineOf } from '../../core/outline';
import { requirementView } from '../../core/requirement-view';
import { kindCounts, WorkspaceStore } from '../../core/workspace-store';
import { ChangeOutline } from '../../shared/change-outline/change-outline';
import { Icon } from '../../shared/icon/icon';
import { ReviewThreadView } from '../../shared/review-thread/review-thread';

/** Whether a review thread sits on the lines of a requirement in the delta document at `path`. */
const onRequirement = (thread: ReviewThread, path: string, requirement: RequirementChange) =>
  thread.path === path &&
  thread.requirement !== null &&
  thread.line !== null &&
  requirement.line <= thread.line &&
  thread.line <= requirement.endLine;

@Component({
  selector: 'app-change-page',
  imports: [DatePipe, RouterLink, ChangeOutline, Icon, ReviewThreadView],
  templateUrl: './change.html',
  styleUrls: ['../reader/reader.css', './change.css'],
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
  /** What the change is, shown above its title. */
  protected readonly eyebrow = computed(() => {
    if (this.pull()) return 'Change in review';
    return this.change()?.archived ? 'Archived change' : 'Active change';
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
    const threads = this.#threads();
    return (change?.deltas ?? []).map((delta) => ({
      ...delta,
      file: this.#fileOf(delta.path, change?.pullRequest),
      requirements: delta.requirements.map((requirement) => ({
        ...requirementView(requirement),
        comment: pull && commentLink(pull, delta.path, requirement),
        threads: threads.filter((thread) => onRequirement(thread, delta.path, requirement)),
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
  /** The document as GitHub lists it among the files of the pull request. */
  #fileOf(path: string, pullRequest?: number): string {
    return [
      this.store.workspace()?.source?.folder,
      this.store.repositoryPath({ path, pullRequest }),
    ]
      .filter(Boolean)
      .join('/');
  }
}
