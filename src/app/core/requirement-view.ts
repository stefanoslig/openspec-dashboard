import type { RequirementChange } from '../../../cli/workspace.model';
import { renderMarkdown } from './render-markdown';
import { diffRequirement } from './requirement-diff';

const html = (markdown: string) =>
  renderMarkdown(markdown, { requirement: true, standalone: true }).html;
/** A requirement block without its heading line. */
const body = (block: string) => block.slice(block.indexOf('\n') + 1 || block.length);
/** A modified requirement whose published text is known, so the two can be compared. */
const comparable = ({ kind, previous }: RequirementChange) =>
  kind === 'modified' && previous !== null;

/** The parts of the requirement against its published text; a changed part is shown by its lines. */
function partsOf(change: RequirementChange) {
  if (!comparable(change)) return [];
  return diffRequirement(change.previous!, change.text).map((part) => ({
    ...part,
    html: part.kind === 'changed' ? '' : html(part.markdown),
  }));
}

/** What the published spec lacks or already has, against what the delta expects. */
function notesOf({ kind, previous }: RequirementChange) {
  return {
    missing: kind !== 'added' && previous === null,
    exists: kind === 'added' && previous !== null,
  };
}

/** The new text, or the reason of a removal with the text removed. */
function textsOf({ kind, previous, text }: RequirementChange) {
  return {
    html: html(kind === 'removed' ? text : body(text)),
    previousHtml: kind === 'removed' && previous !== null ? html(body(previous)) : '',
  };
}

/** A requirement change with everything the change page shows worked out. */
export function requirementView(change: RequirementChange) {
  const parts = partsOf(change);
  return {
    ...change,
    parts,
    identical: comparable(change) && parts.every((part) => part.kind === 'same'),
    ...notesOf(change),
    ...textsOf(change),
  };
}
