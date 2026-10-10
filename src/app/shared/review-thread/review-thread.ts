import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe, I18nPluralPipe } from '@angular/common';
import type { ReviewThread } from '../../../../cli/workspace/model';
import { renderMarkdown } from '../../core/document/render-markdown';
import { Icon } from '../icon/icon';

/** One review thread of a pull request. Read-only: replies happen on GitHub. */
@Component({
  selector: 'app-review-thread',
  imports: [DatePipe, I18nPluralPipe, Icon],
  templateUrl: './review-thread.html',
  styleUrl: './review-thread.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewThreadView {
  readonly thread = input.required<ReviewThread>();
  /** The document and line, for a thread that is not shown under its requirement. */
  readonly place = input('');
  protected readonly comments = computed(() =>
    this.thread().comments.map((comment) => ({
      ...comment,
      html: renderMarkdown(comment.body, { standalone: true }).html,
    })),
  );
  protected readonly count = { '=1': '1 comment', other: '# comments' };
  protected readonly more = { '=1': '1 more comment', other: '# more comments' };
}
