import { isWebLink } from './document-link.ts';
import {
  Marked,
  Renderer,
  type Parser,
  type RendererObject,
  type Token,
  type Tokens,
} from 'marked';

export interface Heading {
  id: string;
  text: string;
  depth: number;
  kind?: 'requirement' | 'scenario' | 'added' | 'modified' | 'removed' | 'renamed';
}
type Kind = NonNullable<Heading['kind']>;
/** The label at the start of a heading, "Requirement:" or "ADDED ", and how long it is. */
interface Label {
  kind: Kind;
  length: number;
}
/** A list item such as "**WHEN** a user signs in", split into its keyword and the rest. */
interface Step {
  keyword: string;
  inline: Token[];
  rest: Token[];
}
interface TaskCount {
  completed: number;
  total: number;
}
/** A requirement, scenario or delta section that is still open while rendering. */
interface Section {
  depth: number;
  kind: Kind;
}

export interface RenderOptions {
  /** The content is the body of a requirement: normative words are emphasized from the start. */
  requirement?: boolean;
  /** Shown outside the reader, where only web links work: no heading anchors, other links as text. */
  standalone?: boolean;
}

/** What the renderers share with the pass over the document that drives them. */
interface RenderState {
  headings: Heading[];
  idOf: (slug: string) => string;
  /** Set while the body of a requirement or a scenario is rendered. */
  emphasize: boolean;
  /** The tasks under the heading being rendered. */
  tasks: TaskCount;
}

const noTasks: TaskCount = { completed: 0, total: 0 };

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const capitalize = (word: string) => word[0].toUpperCase() + word.slice(1);

// "Requirement: …" and "Scenario: …" headings, and the "ADDED Requirements" headings of a delta.
const label = /^(requirement|scenario):\s*|^(added|modified|removed|renamed)\s+(?=requirements)/i;
const normative = /\b(?:(?:SHALL|MUST|SHOULD)(?: NOT)?|MAY)\b/g;
// Step keywords, in bold or plain; a rename lists FROM: and TO: lines.
const boldKeyword = /^(GIVEN|WHEN|THEN|AND|BUT|FROM|TO):?$/i;
const plainKeyword = /^(GIVEN|WHEN|THEN|AND|BUT)\s+|^(FROM|TO):\s*/;

function labelOf(tokens: Token[]): Label | null {
  const first = tokens[0];
  const match = first?.type === 'text' ? label.exec(first.text) : null;
  return match
    ? { kind: (match[1] ?? match[2]).toLowerCase() as Kind, length: match[0].length }
    : null;
}

/** The inline tokens of a list item that is a single paragraph, and the blocks after it. */
function paragraphOf(item: Tokens.ListItem): { inline: Token[]; rest: Token[] } | null {
  const [block, ...rest] = item.tokens;
  if (item.task || (block?.type !== 'text' && block?.type !== 'paragraph')) return null;
  return { inline: (block as Tokens.Paragraph).tokens ?? [], rest };
}

/** A step written "**WHEN** …" or "**WHEN:** …": the colon, and any after the bold, is dropped. */
function boldStep(first: Token | undefined, inline: Token[], rest: Token[]): Step | null {
  const match = first?.type === 'strong' ? boldKeyword.exec(first.text.trim()) : null;
  if (!match) return null;
  const [next, ...more] = inline;
  const text =
    next?.type === 'text' ? [{ ...next, text: next.text.replace(/^[\s:]+/, '') }, ...more] : inline;
  return { keyword: match[1].toUpperCase(), inline: text, rest };
}

/** A rename quotes the whole heading line; only the requirement's name is worth reading. */
function requirementNameOf(inline: Token[]): Token[] {
  const [code, ...more] = inline;
  return code?.type === 'codespan'
    ? [{ ...code, text: code.text.replace(/^#+\s*Requirement:\s*/i, '') }, ...more]
    : inline;
}

/** A step written "WHEN …", or the "FROM: …" and "TO: …" lines of a rename. */
function plainStep(first: Token | undefined, inline: Token[], rest: Token[]): Step | null {
  if (first?.type !== 'text') return null;
  const match = plainKeyword.exec(first.text);
  if (!match) return null;
  const text = { ...first, text: first.text.slice(match[0].length) };
  return {
    keyword: match[1] ?? match[2],
    inline: [text, ...(match[2] ? requirementNameOf(inline) : inline)],
    rest,
  };
}

function stepOf(item: Tokens.ListItem): Step | null {
  const paragraph = paragraphOf(item);
  if (!paragraph) return null;
  const [first, ...inline] = paragraph.inline;
  return boldStep(first, inline, paragraph.rest) ?? plainStep(first, inline, paragraph.rest);
}

/** Every list item among the tokens, those of nested lists included. */
function listItems(tokens: Token[]): Tokens.ListItem[] {
  return tokens
    .filter((token): token is Tokens.List => token.type === 'list')
    .flatMap((list) => list.items.flatMap((item) => [item, ...listItems(item.tokens)]));
}

function countTasks(tokens: Token[]): TaskCount {
  const tasks = listItems(tokens).filter((item) => item.task);
  return { completed: tasks.filter((item) => item.checked).length, total: tasks.length };
}

/** An id from the heading text: its words joined by dashes, or "section" when none are left. */
function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

/** Ids for the headings of one document: a slug taken before gets a number. */
function uniqueIds(): RenderState['idOf'] {
  const used = new Map<string, number>();
  return (slug) => {
    const count = used.get(slug) ?? 0;
    used.set(slug, count + 1);
    return count ? slug + '-' + count : slug;
  };
}

function headingOf(id: string, text: string, depth: number, found: Label | null): Heading {
  return {
    id,
    text: text.replace(/[*`]/g, '').slice(found?.length ?? 0),
    depth,
    ...(found ? { kind: found.kind } : {}),
  };
}

/** The heading tokens without the label at their start. */
function withoutLabel(tokens: Token[], found: Label | null): Token[] {
  const first = tokens[0] as Tokens.Text;
  return found ? [{ ...first, text: first.text.slice(found.length) }, ...tokens.slice(1)] : tokens;
}

const kindSpan = (found: Label | null) =>
  found ? '<span class="kind">' + capitalize(found.kind) + '</span> ' : '';
const taskCountSpan = (tasks: TaskCount) =>
  tasks.total
    ? ' <span class="task-count">' + tasks.completed + ' / ' + tasks.total + '</span>'
    : '';
// Hidden from assistive technology: the same links are in "On this page".
const anchorLink = (id: string) =>
  ' <a class="anchor" href="#' + id + '" aria-hidden="true" tabindex="-1">#</a>';

const emphasizeNormative = (html: string) =>
  html.replace(
    normative,
    (word) =>
      '<strong class="normative' +
      (word.endsWith('NOT') ? ' negative' : '') +
      '">' +
      word +
      '</strong>',
  );

/** Scenario steps; AND and BUT continue the clause before them. */
function renderSteps(steps: Step[], parser: Parser): string {
  let clause = 'and';
  const items = steps.map((step) => {
    if (step.keyword !== 'AND' && step.keyword !== 'BUT') clause = step.keyword.toLowerCase();
    return (
      '<li class="step-' +
      clause +
      '"><span class="step-keyword">' +
      step.keyword +
      '</span> <div class="step-text">' +
      parser.parseInline(step.inline) +
      parser.parse(step.rest) +
      '</div></li>'
    );
  });
  return '<ul class="steps">' + items.join('') + '</ul>';
}

function renderListItem(item: Tokens.ListItem, parser: Parser): string {
  const attributes = item.task ? ' class="task' + (item.checked ? ' done' : '') + '"' : '';
  return '<li' + attributes + '>' + parser.parse(item.tokens) + '</li>';
}

function renderList(token: Tokens.List, parser: Parser): string {
  const tag = token.ordered ? 'ol' : 'ul';
  const start = token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '';
  const attributes = token.items.every((item) => item.task) ? ' class="tasks"' : '';
  const items = token.items.map((item) => renderListItem(item, parser)).join('');
  return '<' + tag + start + attributes + '>' + items + '</' + tag + '>';
}

function rendererFor(state: RenderState, options: RenderOptions): RendererObject {
  return {
    checkbox({ checked }) {
      return (
        '<span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="' +
        checked +
        '" aria-label="' +
        (checked ? 'Completed task' : 'Incomplete task') +
        '">' +
        (checked ? '✓' : '') +
        '</span>'
      );
    },
    heading({ tokens, depth, text }) {
      const id = state.idOf(slugOf(text));
      const found = labelOf(tokens);
      state.headings.push(headingOf(id, text, depth, found));
      const anchor = depth > 1 && !options.standalone ? anchorLink(id) : '';
      return (
        '<h' +
        depth +
        ' id="' +
        id +
        '">' +
        kindSpan(found) +
        this.parser.parseInline(withoutLabel(tokens, found)) +
        taskCountSpan(state.tasks) +
        anchor +
        '</h' +
        depth +
        '>'
      );
    },
    html({ text }) {
      return escape(text);
    },
    image({ text }) {
      return '<span class="image-placeholder">[Image: ' + escape(text) + ']</span>';
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const external = isWebLink(href);
      if (!external && (options.standalone || /^[a-z][a-z0-9+.-]*:/i.test(href))) return label;
      return (
        '<a href="' +
        escape(href) +
        '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : '') +
        '>' +
        label +
        '</a>'
      );
    },
    list(token) {
      const steps = token.items.map(stepOf);
      return steps.length && steps.every((step) => step !== null)
        ? renderSteps(steps, this.parser)
        : renderList(token, this.parser);
    },
    listitem(item) {
      return renderListItem(item, this.parser);
    },
    text(token) {
      const html: string = Renderer.prototype.text.call(this, token);
      return !state.emphasize || ('tokens' in token && token.tokens)
        ? html
        : emphasizeNormative(html);
    },
  };
}

/** The section of a requirement, a scenario or a delta group. */
function sectionStart(kind: Kind): string {
  const delta = kind !== 'requirement' && kind !== 'scenario';
  return '<section class="' + (delta ? 'delta delta-' : '') + kind + '">';
}

/** What a heading closes and opens: a section ends at the next heading of the same or a higher level. */
function sectionsAt(open: Section[], heading: Tokens.Heading): string {
  let html = '';
  while (open.length && open[open.length - 1].depth >= heading.depth) {
    open.pop();
    html += '</section>';
  }
  const found = labelOf(heading.tokens);
  if (!found) return html;
  open.push({ depth: heading.depth, kind: found.kind });
  return html + sectionStart(found.kind);
}

/** The tokens from the heading at `index` to the next heading of the same or a higher level. */
function sectionBody(tokens: Token[], index: number, depth: number): Token[] {
  const end = tokens.findIndex(
    (next, at) => at > index && next.type === 'heading' && next.depth <= depth,
  );
  return tokens.slice(index + 1, end < 0 ? undefined : end);
}

/** The tasks under a heading, shown beside it; the document title shows none. */
function tasksUnder(tokens: Token[], index: number, heading: Tokens.Heading): TaskCount {
  return heading.depth > 1 ? countTasks(sectionBody(tokens, index, heading.depth)) : noTasks;
}

const inRequirement = (open: Section[]) =>
  open.some(({ kind }) => kind === 'requirement' || kind === 'scenario');

export function renderMarkdown(
  content: string,
  options: RenderOptions = {},
): { html: string; headings: Heading[] } {
  const state: RenderState = { headings: [], idOf: uniqueIds(), emphasize: false, tasks: noTasks };
  const parser = new Marked({ gfm: true, renderer: rendererFor(state, options) });
  // Requirements, scenarios and delta groups become sections that end at the next heading of the
  // same or a higher level.
  const tokens = parser.lexer(content);
  const open: Section[] = [];
  let html = '';
  tokens.forEach((token, index) => {
    const heading = token.type === 'heading' ? (token as Tokens.Heading) : null;
    if (heading) {
      html += sectionsAt(open, heading);
      state.tasks = tasksUnder(tokens, index, heading);
    }
    state.emphasize = !heading && (!!options.requirement || inRequirement(open));
    html += parser.parser([token]);
    state.tasks = noTasks;
  });
  return { html: html + '</section>'.repeat(open.length), headings: state.headings };
}
