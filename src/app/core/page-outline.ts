import type { Heading } from './render-markdown';

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
