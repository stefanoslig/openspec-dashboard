// Reads requirement blocks with the rules of the OpenSpec CLI (core/parsers/requirement-blocks),
// so the dashboard shows what `openspec archive` would apply.

export interface RequirementBlock {
  name: string;
  /** Markdown of the block from its header on. For a removal: the reason under the header. */
  text: string;
  /** 1-based lines in the document. */
  line: number;
  endLine: number;
}
export interface Rename {
  from: string;
  to: string;
  line: number;
  endLine: number;
}
export interface Delta {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: RequirementBlock[];
  renamed: Rename[];
}
interface Lines {
  lines: string[];
  /** True for the lines of a fenced code block, its fences included. */
  fenced: boolean[];
}
interface Range {
  start: number;
  end: number;
}
/** An open code fence: only a run of the same marker at least as long closes it. */
interface Fence {
  marker: string;
  length: number;
}

const requirementHeader = /^###\s*Requirement:\s*(.+)\s*$/i;
const removedBullet = /^\s*[-*+]\s*`?###\s*Requirement:\s*(.+?)`?\s*$/;
const renameFrom = /^\s*[-*+]?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/;
const renameTo = /^\s*[-*+]?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/;

// A closing run of #s is not part of a heading's text.
const nameOf = (text: string) => text.replace(/[ \t]+#+[ \t]*$/, '').trim();

/** The fence open after a line: the one it opens, or the current one unless the line closes it. */
function fenceAfter(line: string, open: Fence | null): Fence | null {
  if (!open) {
    const start = /^\s*(`{3,}|~{3,})/.exec(line);
    return start ? { marker: start[1][0], length: start[1].length } : null;
  }
  const end = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  const closes = end !== null && end[1][0] === open.marker && end[1].length >= open.length;
  return closes ? null : open;
}

/** The lines of a document with normalised line ends, and which of them a code fence covers. */
function linesOf(content: string): Lines {
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const fenced: boolean[] = [];
  let open: Fence | null = null;
  for (const line of lines) {
    const after = fenceAfter(line, open);
    // A fence line is covered whether it opens or closes the block.
    fenced.push(open !== null || after !== null);
    open = after;
  }
  return { lines, fenced };
}

/** The bodies of the `## ` sections, with their titles in lower case. */
function sections({ lines, fenced }: Lines): (Range & { title: string })[] {
  const heads = lines.flatMap((line, index) => {
    const match = fenced[index] ? null : /^##\s+(.+)$/.exec(line);
    return match ? [{ title: match[1].trim().toLowerCase(), index }] : [];
  });
  return heads.map((head, at) => ({
    title: head.title,
    start: head.index + 1,
    end: heads[at + 1]?.index ?? lines.length,
  }));
}

const isHeader = ({ lines, fenced }: Lines, index: number) =>
  !fenced[index] && requirementHeader.test(lines[index]);

/** Where the block opening at `header` ends: `next` is the next header or `end`, `last` the line
 * before it once trailing blank lines are dropped. */
function blockEnd(document: Lines, header: number, end: number): { next: number; last: number } {
  let next = header + 1;
  while (next < end && !isHeader(document, next)) next++;
  let last = next - 1;
  while (last > header && !document.lines[last].trim()) last--;
  return { next, last };
}

/** Each block runs from its header to the next requirement header or the end of the range. */
function blocks(document: Lines, { start, end }: Range): RequirementBlock[] {
  const found: RequirementBlock[] = [];
  for (let index = start; index < end; index++) {
    if (!isHeader(document, index)) continue;
    const { next, last } = blockEnd(document, index, end);
    found.push({
      name: nameOf(requirementHeader.exec(document.lines[index])![1]),
      text: document.lines
        .slice(index, last + 1)
        .join('\n')
        .trimEnd(),
      line: index + 1,
      endLine: last + 1,
    });
    index = next - 1;
  }
  return found;
}

/** Removals are written as headers, with a reason under them, or as bullets that quote a header. */
function removals(document: Lines, range: Range): RequirementBlock[] {
  const result = blocks(document, range).map((block) => ({
    ...block,
    text: block.text.slice(block.text.indexOf('\n') + 1 || block.text.length).trim(),
  }));
  for (let index = range.start; index < range.end; index++) {
    const match = document.fenced[index] ? null : removedBullet.exec(document.lines[index]);
    if (match)
      result.push({ name: nameOf(match[1]), text: '', line: index + 1, endLine: index + 1 });
  }
  return result.sort((a, b) => a.line - b.line);
}

/** A pair is a FROM followed by a TO; a FROM or TO without its partner is ignored. */
function renames({ lines, fenced }: Lines, { start, end }: Range): Rename[] {
  const result: Rename[] = [];
  let pending: { name: string; line: number } | undefined;
  for (let index = start; index < end; index++) {
    if (fenced[index]) continue;
    const from = renameFrom.exec(lines[index]);
    const to = renameTo.exec(lines[index]);
    if (from) pending = { name: nameOf(from[1]), line: index + 1 };
    else if (to && pending) {
      result.push({
        from: pending.name,
        to: nameOf(to[1]),
        line: pending.line,
        endLine: index + 1,
      });
      pending = undefined;
    }
  }
  return result;
}

export function parseDelta(content: string): Delta {
  const document = linesOf(content);
  const delta: Delta = { added: [], modified: [], removed: [], renamed: [] };
  for (const section of sections(document)) {
    if (section.title === 'added requirements') delta.added.push(...blocks(document, section));
    else if (section.title === 'modified requirements')
      delta.modified.push(...blocks(document, section));
    else if (section.title === 'removed requirements')
      delta.removed.push(...removals(document, section));
    else if (section.title === 'renamed requirements')
      delta.renamed.push(...renames(document, section));
  }
  return delta;
}

/** The requirement blocks of a published spec: those inside its `## Requirements` section. */
export function publishedRequirements(content: string): RequirementBlock[] {
  const document = linesOf(content);
  const section = sections(document).find(({ title }) => title === 'requirements');
  return section ? blocks(document, section) : [];
}
