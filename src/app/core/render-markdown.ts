import { Marked, Renderer, type Token, type Tokens } from 'marked';

export interface Heading {
  id: string;
  text: string;
  depth: number;
  kind?: 'requirement' | 'scenario' | 'added' | 'modified' | 'removed' | 'renamed';
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "Requirement: …" and "Scenario: …" headings, and the "ADDED Requirements" headings of a delta.
const label = /^(requirement|scenario):\s*|^(added|modified|removed|renamed)\s+(?=requirements)/i;
const normative = /\b(?:(?:SHALL|MUST|SHOULD)(?: NOT)?|MAY)\b/g;

function labelOf(tokens: Token[]): { kind: NonNullable<Heading['kind']>; length: number } | null {
  const first = tokens[0];
  const match = first?.type === 'text' ? label.exec(first.text) : null;
  return match
    ? {
        kind: (match[1] ?? match[2]).toLowerCase() as NonNullable<Heading['kind']>,
        length: match[0].length,
      }
    : null;
}

/** Splits a list item such as "**WHEN** a user signs in" into its keyword and the rest. */
function stepOf(item: Tokens.ListItem): { keyword: string; inline: Token[]; rest: Token[] } | null {
  const [block, ...rest] = item.tokens;
  if (item.task || (block?.type !== 'text' && block?.type !== 'paragraph')) return null;
  const [first, ...inline] = (block as Tokens.Paragraph).tokens ?? [];
  if (first?.type === 'strong') {
    const match = /^(GIVEN|WHEN|THEN|AND|BUT|FROM|TO):?$/i.exec(first.text.trim());
    if (!match) return null;
    const next = inline[0];
    if (next?.type === 'text') inline[0] = { ...next, text: next.text.replace(/^[\s:]+/, '') };
    return { keyword: match[1].toUpperCase(), inline, rest };
  }
  if (first?.type !== 'text') return null;
  const match = /^(GIVEN|WHEN|THEN|AND|BUT)\s+|^(FROM|TO):\s*/.exec(first.text);
  if (!match) return null;
  // A rename quotes the whole heading line; only the requirement's name is worth reading.
  if (match[2] && inline[0]?.type === 'codespan')
    inline[0] = { ...inline[0], text: inline[0].text.replace(/^#+\s*Requirement:\s*/i, '') };
  return {
    keyword: match[1] ?? match[2],
    inline: [{ ...first, text: first.text.slice(match[0].length) }, ...inline],
    rest,
  };
}

function countTasks(tokens: Token[], count = { completed: 0, total: 0 }) {
  for (const token of tokens) {
    if (token.type !== 'list') continue;
    for (const item of (token as Tokens.List).items) {
      if (item.task) {
        count.total++;
        if (item.checked) count.completed++;
      }
      countTasks(item.tokens, count);
    }
  }
  return count;
}

export function renderMarkdown(content: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  // Set while a section is rendered, for the renderers below.
  let emphasize = false;
  let tasks = { completed: 0, total: 0 };
  const parser = new Marked({
    gfm: true,
    renderer: {
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
        const base =
          text
            .toLowerCase()
            .replace(/<[^>]*>/g, '')
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .trim()
            .replace(/\s+/g, '-') || 'section';
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const id = count ? base + '-' + count : base;
        const found = labelOf(tokens);
        const first = tokens[0] as Tokens.Text;
        const title = found
          ? [{ ...first, text: first.text.slice(found.length) }, ...tokens.slice(1)]
          : tokens;
        headings.push({
          id,
          text: text.replace(/[*`]/g, '').slice(found?.length ?? 0),
          depth,
          ...(found ? { kind: found.kind } : {}),
        });
        return (
          '<h' +
          depth +
          ' id="' +
          id +
          '">' +
          (found
            ? '<span class="kind">' + found.kind[0].toUpperCase() + found.kind.slice(1) + '</span> '
            : '') +
          this.parser.parseInline(title) +
          (tasks.total
            ? ' <span class="task-count">' + tasks.completed + ' / ' + tasks.total + '</span>'
            : '') +
          // Hidden from assistive technology: the same links are in "On this page".
          (depth > 1
            ? ' <a class="anchor" href="#' + id + '" aria-hidden="true" tabindex="-1">#</a>'
            : '') +
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
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href)) return label;
        const external = /^(https?:|mailto:)/i.test(href);
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
        if (steps.length && steps.every((step) => step !== null)) {
          // AND and BUT continue the clause before them.
          let clause = 'and';
          return (
            '<ul class="steps">' +
            steps
              .map((step) => {
                if (step.keyword !== 'AND' && step.keyword !== 'BUT')
                  clause = step.keyword.toLowerCase();
                return (
                  '<li class="step-' +
                  clause +
                  '"><span class="step-keyword">' +
                  step.keyword +
                  '</span> <div class="step-text">' +
                  this.parser.parseInline(step.inline) +
                  this.parser.parse(step.rest) +
                  '</div></li>'
                );
              })
              .join('') +
            '</ul>'
          );
        }
        const tag = token.ordered ? 'ol' : 'ul';
        return (
          '<' +
          tag +
          (token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '') +
          (token.items.every((item) => item.task) ? ' class="tasks"' : '') +
          '>' +
          token.items.map((item) => this.listitem(item)).join('') +
          '</' +
          tag +
          '>'
        );
      },
      listitem(item) {
        return (
          '<li' +
          (item.task ? ' class="task' + (item.checked ? ' done' : '') + '"' : '') +
          '>' +
          this.parser.parse(item.tokens) +
          '</li>'
        );
      },
      text(token) {
        const html: string = Renderer.prototype.text.call(this, token);
        return !emphasize || ('tokens' in token && token.tokens)
          ? html
          : html.replace(
              normative,
              (word: string) =>
                '<strong class="normative' +
                (word.endsWith('NOT') ? ' negative' : '') +
                '">' +
                word +
                '</strong>',
            );
      },
    },
  });

  // Requirements, scenarios and delta groups become sections that end at the next heading of the
  // same or a higher level.
  const tokens = parser.lexer(content);
  const open: { depth: number; kind: string }[] = [];
  let html = '';
  tokens.forEach((token, index) => {
    const heading = token.type === 'heading' ? (token as Tokens.Heading) : null;
    if (heading) {
      while (open.length && open[open.length - 1].depth >= heading.depth) {
        open.pop();
        html += '</section>';
      }
      const found = labelOf(heading.tokens);
      if (found) {
        const delta = found.kind !== 'requirement' && found.kind !== 'scenario';
        html += '<section class="' + (delta ? 'delta delta-' : '') + found.kind + '">';
        open.push({ depth: heading.depth, kind: found.kind });
      }
      const end = tokens.findIndex(
        (next, at) => at > index && next.type === 'heading' && next.depth <= heading.depth,
      );
      if (heading.depth > 1) tasks = countTasks(tokens.slice(index + 1, end < 0 ? undefined : end));
    }
    emphasize = !heading && open.some(({ kind }) => kind === 'requirement' || kind === 'scenario');
    html += parser.parser([token]);
    tasks = { completed: 0, total: 0 };
  });
  return { html: html + '</section>'.repeat(open.length), headings };
}
