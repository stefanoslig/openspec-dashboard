import type { Change } from '../../../../cli/workspace/model.ts';

/** The listing of the overview a document is reached from. */
export type BackView = 'archive' | 'changes' | 'specs' | 'artifacts';

const backLabels: Record<BackView, string> = {
  archive: 'Archive',
  changes: 'All changes',
  specs: 'All specifications',
  artifacts: 'All artifacts',
};

/** What a document belongs to: a change, archived or perhaps in review, or a capability. */
export interface DocumentPlace {
  change?: Pick<Change, 'archived'>;
  inReview: boolean;
  capability?: string;
}

export interface DocumentContext {
  /** What the document is part of, shown above its title. */
  eyebrow: string;
  /** The listing the document came from, and the label of the link back to it. */
  backView: BackView;
  backLabel: string;
}

function eyebrowOf({ change, inReview, capability }: DocumentPlace): string {
  if (change?.archived) return 'Archived change';
  if (inReview) return 'Change in review';
  if (change) return 'Active change';
  return capability === undefined ? 'Workspace artifact' : 'Specification';
}

function backViewOf({ change, capability }: DocumentPlace): BackView {
  if (change?.archived) return 'archive';
  if (change) return 'changes';
  return capability === undefined ? 'artifacts' : 'specs';
}

/** How the reader presents where a document sits: its eyebrow and the way back to its listing. */
export function documentContext(place: DocumentPlace): DocumentContext {
  const backView = backViewOf(place);
  return { eyebrow: eyebrowOf(place), backView, backLabel: backLabels[backView] };
}
