import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { lexer, type Token, type Tokens } from 'marked';
import { isMap, isScalar, parseAllDocuments, type Scalar } from 'yaml';
import type { Artifact, ArtifactFile, Change, Workspace } from './workspace.model.ts';

export interface MarkdownInfo {
  completed: number;
  total: number;
  requirements: number;
  scenarios: number;
  summary: string;
}
export interface BuildOptions {
  name: string;
  root: string;
  isDemo?: boolean;
  source?: Workspace['source'];
  warnings?: string[];
  now?: Date;
}

const order = ['refine.md', 'proposal.md', 'design.md', 'tasks.md'];
const labels = new Map([
  ['proposal', 'Proposal'],
  ['design', 'Design'],
  ['tasks', 'Tasks'],
  ['refine', 'Requirements'],
  ['spec', 'Specification'],
]);
// Code-unit order, so results do not depend on the machine's locale.
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function humanize(value: string): string {
  const words = value.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function walk(tokens: Token[], visit: (token: Tokens.Generic) => void): void {
  for (const token of tokens as Tokens.Generic[]) {
    visit(token);
    if (token.type === 'list') walk(token['items'], visit);
    else if (token.type === 'table')
      for (const cell of [...token['header'], ...token['rows'].flat()]) walk(cell.tokens, visit);
    else if (token.tokens) walk(token.tokens, visit);
  }
}

// Text of a heading without emphasis markers; code spans and raw HTML are left out.
function plainText(tokens: Token[]): string {
  let text = '';
  for (const token of tokens as Tokens.Generic[]) {
    if (token.type === 'codespan' || token.type === 'html') continue;
    if (token.tokens) text += plainText(token.tokens);
    else if (token.type === 'text' || token.type === 'escape') text += token['text'];
  }
  return text;
}

export function inspectMarkdown(content: string): MarkdownInfo {
  const tokens = lexer(content);
  const info = { completed: 0, total: 0, requirements: 0, scenarios: 0, summary: '' };
  walk(tokens, (token) => {
    if (token.type === 'list_item' && token['task']) {
      info.total++;
      if (token['checked']) info.completed++;
    } else if (token.type === 'heading') {
      const text = plainText(token.tokens ?? []).toLowerCase();
      if (text.startsWith('requirement:')) info.requirements++;
      else if (text.startsWith('scenario:')) info.scenarios++;
    }
  });
  const paragraph = tokens.find((token) => token.type === 'paragraph') as Tokens.Paragraph;
  info.summary = (paragraph?.text ?? '').trim().replace(/[*`]/g, '').slice(0, 240);
  return info;
}

const scalarText = (node: Scalar) =>
  typeof node.source === 'string' ? node.source : String(node.value ?? '');

/** Top-level scalar keys of a YAML mapping. Throws when the YAML is invalid. */
function configuration(content: string): Map<string, string | null> {
  const documents = parseAllDocuments(content);
  for (const document of documents) if (document.errors.length) throw document.errors[0];
  const result = new Map<string, string | null>();
  const root = documents[0]?.contents;
  if (!isMap(root)) return result;
  for (const pair of root.items)
    if (isScalar(pair.key))
      result.set(scalarText(pair.key), isScalar(pair.value) ? scalarText(pair.value) : null);
  return result;
}

export function buildWorkspace(files: ArtifactFile[], options: BuildOptions): Workspace {
  const warnings = [...(options.warnings ?? [])];
  const modified = new Map(files.map((file) => [file.path, file.modified]));
  const iso = (time: number | null | undefined) =>
    time == null ? null : new Date(time).toISOString();
  const documents = files
    .map((file): Artifact => {
      const markdown = file.path.toLowerCase().endsWith('.md');
      const filename = posix.parse(file.path).name;
      return {
        path: file.path,
        title: labels.get(filename) ?? humanize(filename),
        content: file.content,
        format: markdown ? 'markdown' : 'yaml',
        modified: iso(file.modified),
        revision: createHash('sha256').update(file.content, 'utf8').digest('hex'),
        ...inspectMarkdown(markdown ? file.content : ''),
      };
    })
    .sort((a, b) => ordinal(a.path, b.path));

  let settings = new Map<string, string | null>();
  try {
    settings = configuration(
      documents.find((doc) => /^config\.ya?ml$/.test(doc.path))?.content ?? '',
    );
  } catch {
    warnings.push('config.yaml could not be parsed. Its source is still available in Artifacts.');
  }
  if (settings.has('store'))
    warnings.push(
      'This project declares an external OpenSpec store. Connect to that store repository to read its artifacts; store registration is not resolved automatically.',
    );
  const schema = settings.get('schema') ?? 'spec-driven';

  const groups = new Map<string, Artifact[]>();
  for (const doc of documents) {
    const parts = doc.path.split('/');
    const depth = parts[1] === 'archive' ? 3 : 2;
    if (parts[0] !== 'changes' || parts.length <= depth) continue;
    const id = parts.slice(0, depth).join('/');
    groups.set(id, [...(groups.get(id) ?? []), doc]);
  }
  const changeTimes = new Map<string, number | null>();
  const changes = [...groups].map(([id, docs]): Change => {
    const name = id.slice(id.lastIndexOf('/') + 1);
    const tasks = docs.find((doc) => doc.path === id + '/tasks.md');
    const proposal = docs.find((doc) => doc.path === id + '/proposal.md');
    let changeSchema = schema;
    try {
      const metadata = docs.find((doc) => doc.path === id + '/.openspec.yaml')?.content ?? '';
      changeSchema = configuration(metadata).get('schema') ?? schema;
    } catch {
      warnings.push(`Invalid metadata in ${name}.`);
    }
    const total = tasks?.total ?? 0;
    const completed = tasks?.completed ?? 0;
    const times = docs.map((doc) => modified.get(doc.path)).filter((time) => time != null);
    changeTimes.set(id, times.length ? Math.max(...times) : null);
    const rank = (doc: Artifact) => {
      const index = order.indexOf(doc.path.slice(id.length + 1));
      return index < 0 ? 10 : index;
    };
    return {
      id,
      name,
      title: humanize(name),
      archived: id.startsWith('changes/archive/'),
      schema: changeSchema,
      status:
        total === 0
          ? 'Draft'
          : completed === total
            ? 'Complete'
            : completed > 0
              ? 'In progress'
              : 'Planned',
      completed,
      total,
      summary: proposal ? proposal.summary : 'Open this change to explore its artifacts.',
      modified: iso(changeTimes.get(id)),
      documents: [...docs]
        .sort((a, b) => rank(a) - rank(b) || ordinal(a.path, b.path))
        .map((doc) => doc.path),
    };
  });
  // Newest first; changes without a date come last.
  const time = (change: Change) => changeTimes.get(change.id) ?? Number.NEGATIVE_INFINITY;
  changes.sort((a, b) => (time(a) === time(b) ? ordinal(a.id, b.id) : time(a) < time(b) ? 1 : -1));

  const specs = documents
    .filter((doc) => doc.path.startsWith('specs/') && doc.path.endsWith('/spec.md'))
    .map((doc) => ({
      path: doc.path,
      capability: doc.path.slice('specs/'.length, -'/spec.md'.length),
      requirements: doc.requirements,
      scenarios: doc.scenarios,
    }));
  return {
    name: options.name,
    root: options.root,
    isDemo: options.isDemo ?? false,
    ...(options.source ? { source: options.source } : {}),
    schema,
    loadedAt: (options.now ?? new Date()).toISOString(),
    documents,
    changes,
    warnings,
    specs,
  };
}
