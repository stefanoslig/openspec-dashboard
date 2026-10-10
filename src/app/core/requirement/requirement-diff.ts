import { diffArrays, diffWordsWithSpace } from 'diff';

export interface Segment {
  text: string;
  kind: 'same' | 'added' | 'removed';
}
export interface Line {
  kind: 'same' | 'added' | 'removed' | 'changed';
  /** WHEN, THEN and the like when the line is a scenario step, otherwise empty. */
  keyword: string;
  segments: Segment[];
}
/** The statement of a requirement or one of its scenarios. */
export interface Part {
  /** Scenario name; empty for the statement. */
  name: string;
  kind: Line['kind'];
  /** Markdown of a part that is unchanged, added or removed as a whole. */
  markdown: string;
  /** The lines of a changed part. */
  lines: Line[];
}
interface Block {
  name: string;
  /** The scenario's heading line; empty for the statement. */
  heading: string;
  body: string;
}
interface Row {
  keyword: string;
  text: string;
}

// A pair of lines that shares fewer of its words than this is shown as two whole lines.
const shared = 0.4;
// Punctuation on its own is not a word.
const words = (text: string) =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** The statement under the requirement's heading, then its scenarios: `####` headings outside code fences. */
function split(requirement: string): Block[] {
  const lines = requirement.replace(/\r\n?/g, '\n').split('\n').slice(1);
  const starts: number[] = [];
  let open: string | undefined;
  lines.forEach((line, index) => {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && !fence[2].trim())
        open = undefined;
    } else if (fence) open = fence[1];
    else if (/^####\s+/.test(line)) starts.push(index);
  });
  const text = (from: number, to?: number) => lines.slice(from, to).join('\n').trim();
  return [
    { name: '', heading: '', body: text(0, starts[0]) },
    ...starts.map((start, at) => ({
      name: lines[start]
        .replace(/^####\s+/, '')
        .replace(/[ \t]+#+[ \t]*$/, '')
        .replace(/^Scenario:\s*/i, '')
        .trim(),
      heading: lines[start],
      body: text(start + 1, starts[at + 1]),
    })),
  ];
}

/** A line as it is displayed: without list, heading and emphasis markers, its step keyword apart. */
function row(line: string): Row {
  const plain = line
    .trim()
    .replace(/^(?:[-*+]|\d+[.)]|#+)\s+/, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ');
  const step = /^(GIVEN|WHEN|THEN|AND|BUT)\s+/.exec(plain);
  return step
    ? { keyword: step[1], text: plain.slice(step[0].length) }
    : { keyword: '', text: plain };
}

const whole = (kind: 'same' | 'added' | 'removed', { keyword, text }: Row): Line => ({
  kind,
  keyword,
  segments: [{ text, kind }],
});

/** Joins changes that only white space separates, so a reworded phrase reads as one change. */
function joined(segments: Segment[]): Segment[] {
  const result: Segment[] = [];
  const push = (kind: Segment['kind'], text: string) => {
    const last = result[result.length - 1];
    if (last?.kind === kind) last.text += text;
    else if (text) result.push({ text, kind });
  };
  for (let index = 0; index < segments.length;) {
    if (segments[index].kind === 'same') {
      push('same', segments[index++].text);
      continue;
    }
    const text = { added: '', removed: '' };
    for (; index < segments.length; index++) {
      const segment = segments[index];
      if (segment.kind !== 'same') text[segment.kind] += segment.text;
      else if (segment.text.trim() || (segments[index + 1]?.kind ?? 'same') === 'same') break;
      else {
        text.added += segment.text;
        text.removed += segment.text;
      }
    }
    // White space at the end of a change is not marked.
    push('removed', text.removed.trimEnd());
    push('added', text.added.trimEnd());
    push('same', /\s*$/.exec(text.added.trim() ? text.added : text.removed)![0]);
  }
  return result;
}

function pair(before: Row, after: Row): Line[] {
  const apart = [whole('removed', before), whole('added', after)];
  if (before.keyword !== after.keyword) return apart;
  const segments = diffWordsWithSpace(before.text, after.text).map((change): Segment => ({
    text: change.value,
    kind: change.added ? 'added' : change.removed ? 'removed' : 'same',
  }));
  const kept = segments
    .filter((segment) => segment.kind === 'same')
    .reduce((count, segment) => count + words(segment.text), 0);
  return kept / Math.max(words(before.text), words(after.text)) < shared
    ? apart
    : [{ kind: 'changed', keyword: after.keyword, segments: joined(segments) }];
}

function lines(before: string, after: string): Line[] {
  const rows = (text: string) =>
    text
      .split('\n')
      // The markers of a code fence are not text.
      .filter((line) => !/^\s*(`{3,}|~{3,})/.test(line))
      .map(row)
      .filter(({ keyword, text }) => keyword || text);
  const hunks = diffArrays(rows(before), rows(after), {
    comparator: (a, b) => a.keyword === b.keyword && a.text === b.text,
  });
  const result: Line[] = [];
  for (let index = 0; index < hunks.length; index++) {
    const hunk = hunks[index];
    const next = hunks[index + 1];
    if (hunk.removed && next?.added) {
      // Replaced lines are compared one to one, in order.
      const length = Math.max(hunk.value.length, next.value.length);
      for (let at = 0; at < length; at++) {
        const old = hunk.value[at];
        const now = next.value[at];
        if (old && now) result.push(...pair(old, now));
        else result.push(old ? whole('removed', old) : whole('added', now));
      }
      index++;
    } else {
      const kind = hunk.added ? 'added' : hunk.removed ? 'removed' : 'same';
      result.push(...hunk.value.map((value) => whole(kind, value)));
    }
  }
  return result;
}

/**
 * Compares the published text of a requirement with its new text, both starting at their
 * `### Requirement:` heading. Scenarios are matched by name.
 */
export function diffRequirement(previous: string, next: string): Part[] {
  const markdown = (block: Block) => (block.heading ? block.heading + '\n\n' : '') + block.body;
  const before = split(previous);
  const unmatched = [...before];
  const origin = new Map<Part, Block>();
  const parts = split(next).map((block): Part => {
    const index = unmatched.findIndex((old) => old.name === block.name);
    const base = { name: block.name, markdown: markdown(block), lines: [] };
    if (index < 0) return { ...base, kind: 'added' };
    const [old] = unmatched.splice(index, 1);
    const changes = lines(old.body, block.body);
    const part: Part = changes.every((line) => line.kind === 'same')
      ? { ...base, kind: 'same' }
      : { ...base, kind: 'changed', markdown: '', lines: changes };
    origin.set(part, old);
    return part;
  });
  // A dropped scenario keeps its place: after the scenario it followed in the published text.
  let at = 0;
  for (const old of before) {
    const index = parts.findIndex((part) => origin.get(part) === old);
    if (index >= 0) at = index + 1;
    else
      parts.splice(at++, 0, {
        name: old.name,
        kind: 'removed',
        markdown: markdown(old),
        lines: [],
      });
  }
  return parts.filter((part) => part.name || part.markdown || part.lines.length);
}
