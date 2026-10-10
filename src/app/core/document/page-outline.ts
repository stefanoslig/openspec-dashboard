import type { Heading } from './render-markdown.ts';

/** A heading as "On this page" lists it. */
export interface PageHeading extends Heading {
  /** How far the heading is indented, 0 to 2. */
  level: number;
  /** Id of the requirement a scenario belongs to; empty for other headings. */
  parent: string;
}

/** The heading of a delta group reads as a phrase, "Added requirements"; others keep their text. */
const textOf = ({ kind, text }: Heading) =>
  kind && kind !== 'requirement' && kind !== 'scenario'
    ? kind.charAt(0).toUpperCase() + kind.slice(1) + ' ' + text.toLowerCase()
    : text;

/** Headings for "On this page": the document title is left out, scenarios know their requirement. */
export function pageOutline(all: Heading[]): PageHeading[] {
  const headings = all.filter((heading) => heading.depth === 1).length === 1 ? all.slice(1) : all;
  const top = Math.min(...headings.map((heading) => heading.depth));
  let requirement = '';
  return headings.map((heading) => {
    if (heading.kind !== 'scenario') requirement = heading.kind === 'requirement' ? heading.id : '';
    return {
      ...heading,
      text: textOf(heading),
      level: Math.min(heading.depth - top, 2),
      parent: heading.kind === 'scenario' ? requirement : '',
    };
  });
}

/**
 * Past `limit` headings, the outline keeps the headings without a parent and the scenarios of the
 * requirement being read, the one that holds the active heading.
 */
export function collapseOutline(
  headings: PageHeading[],
  activeId: string,
  limit = 18,
): PageHeading[] {
  if (headings.length <= limit) return headings;
  const active = headings.find((heading) => heading.id === activeId);
  // The requirement being read is the parent of a scenario, or the active heading itself.
  const requirement = active?.parent || active?.id;
  return headings.filter((heading) => !heading.parent || heading.parent === requirement);
}
