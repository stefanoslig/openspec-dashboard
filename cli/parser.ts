import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { lexer, type Token, type Tokens } from 'marked';
import { isMap, isScalar, parseAllDocuments, type Scalar } from 'yaml';
import { parseDelta, publishedRequirements } from './delta.ts';
import type {
  Artifact,
  ArtifactFile,
  Change,
  PullRequest,
  PullRequestInput,
  RequirementChange,
  SpecDelta,
  Workspace,
} from './workspace.model.ts';

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
  /** Open pull requests to show next to the files; leave out when they were not read. */
  pullRequests?: PullRequestInput[];
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

/** A published spec: its path and the text of its requirements by name. */
type Published = (
  capability: string,
) => { path: string; requirements: Map<string, string> } | undefined;

/** What the delta specs of a change do to the requirements of the published specs. */
function deltasOf(id: string, docs: Artifact[], published: Published): SpecDelta[] {
  return docs.flatMap((doc): SpecDelta[] => {
    const capability = /^specs\/(.+)\/spec\.md$/.exec(doc.path.slice(id.length + 1))?.[1];
    if (!capability) return [];
    const delta = parseDelta(doc.content);
    const spec = published(capability);
    const previous = (name: string) => spec?.requirements.get(name) ?? null;
    const renames = new Map(delta.renamed.map((rename) => [rename.to, rename]));
    const requirements: RequirementChange[] = [];
    for (const block of delta.added)
      requirements.push({ kind: 'added', ...block, previous: previous(block.name) });
    for (const block of delta.modified) {
      // OpenSpec renames before it modifies, so a renamed requirement is modified under its new name.
      const rename = renames.get(block.name);
      renames.delete(block.name);
      requirements.push({
        kind: 'modified',
        ...block,
        ...(rename ? { previousName: rename.from } : {}),
        previous: previous(rename?.from ?? block.name),
      });
    }
    for (const block of delta.removed)
      requirements.push({ kind: 'removed', ...block, previous: previous(block.name) });
    for (const rename of renames.values())
      requirements.push({
        kind: 'renamed',
        name: rename.to,
        previousName: rename.from,
        text: '',
        previous: previous(rename.from),
        line: rename.line,
        endLine: rename.endLine,
      });
    if (!requirements.length) return [];
    requirements.sort((a, b) => a.line - b.line);
    return [{ path: doc.path, capability, published: spec?.path ?? null, requirements }];
  });
}

export function buildWorkspace(files: ArtifactFile[], options: BuildOptions): Workspace {
  const warnings = [...(options.warnings ?? [])];
  const modified = new Map(files.map((file) => [file.path, file.modified]));
  const iso = (time: number | null | undefined) =>
    time == null ? null : new Date(time).toISOString();
  const artifacts = (from: ArtifactFile[], prefix = '', pullRequest?: number) =>
    from
      .map((file): Artifact => {
        const markdown = file.path.toLowerCase().endsWith('.md');
        const filename = posix.parse(file.path).name;
        return {
          path: prefix + file.path,
          title: labels.get(filename) ?? humanize(filename),
          content: file.content,
          format: markdown ? 'markdown' : 'yaml',
          modified: iso(file.modified),
          revision: createHash('sha256').update(file.content, 'utf8').digest('hex'),
          ...inspectMarkdown(markdown ? file.content : ''),
          ...(pullRequest === undefined ? {} : { pullRequest }),
        };
      })
      .sort((a, b) => ordinal(a.path, b.path));
  const documents = artifacts(files);

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

  const read = new Map<string, ReturnType<Published>>();
  const published: Published = (capability) => {
    const path = 'specs/' + capability + '/spec.md';
    if (!read.has(path)) {
      const spec = documents.find((doc) => doc.path === path);
      read.set(
        path,
        spec && {
          path,
          requirements: new Map(
            publishedRequirements(spec.content).map((block) => [block.name, block.text]),
          ),
        },
      );
    }
    return read.get(path);
  };
  const changeTimes = new Map<string, number | null>();
  /** Groups documents into changes. The documents of a pull request share a path prefix. */
  const changesOf = (all: Artifact[], prefix = '', pull?: PullRequestInput): Change[] => {
    const groups = new Map<string, Artifact[]>();
    for (const doc of all) {
      const parts = doc.path.slice(prefix.length).split('/');
      const depth = parts[1] === 'archive' ? 3 : 2;
      if (parts[0] !== 'changes' || parts.length <= depth) continue;
      const id = prefix + parts.slice(0, depth).join('/');
      groups.set(id, [...(groups.get(id) ?? []), doc]);
    }
    return [...groups].map(([id, docs]) => changeOf(id, docs, pull));
  };
  const changeOf = (id: string, docs: Artifact[], pull?: PullRequestInput): Change => {
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
    const times = pull
      ? [Date.parse(pull.updatedAt)].filter((time) => !Number.isNaN(time))
      : docs.map((doc) => modified.get(doc.path)).filter((time) => time != null);
    changeTimes.set(id, times.length ? Math.max(...times) : null);
    const rank = (doc: Artifact) => {
      const index = order.indexOf(doc.path.slice(id.length + 1));
      return index < 0 ? 10 : index;
    };
    // Until it merges a change is in review, also when its pull request has archived it already.
    const archived = !pull && id.startsWith('changes/archive/');
    return {
      id,
      name,
      title: humanize(name),
      archived,
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
      // An archived change is already in the published specs, so the text it replaced is gone.
      deltas: archived ? [] : deltasOf(id, docs, published),
      ...(pull ? { pullRequest: pull.number } : {}),
    };
  };
  const changes = changesOf(documents);
  // A pull request that changes no specs is left out, with its documents.
  const pullRequests = (options.pullRequests ?? []).flatMap((pull): PullRequest[] => {
    const prefix = `.pulls/${pull.number}/`;
    const docs = artifacts(pull.files, prefix, pull.number);
    const found = changesOf(docs, prefix, pull);
    if (!found.length) return [];
    documents.push(...docs);
    changes.push(...found);
    const { files: _, threads, reviewFiles, ...details } = pull;
    const owned = new Set(found.flatMap((change) => change.documents));
    const deltas = found.flatMap((change) => change.deltas);
    return [
      {
        ...details,
        changes: found.map((change) => change.id),
        threads: threads.flatMap((thread) => {
          const path = prefix + thread.path;
          if (!owned.has(path)) return [];
          const { line } = thread;
          const pinned =
            line === null
              ? undefined
              : deltas
                  .find((delta) => delta.path === path)
                  ?.requirements.find((change) => change.line <= line && line <= change.endLine);
          return [{ ...thread, path, requirement: pinned?.name ?? null }];
        }),
        // Older inputs have none: the key stays absent rather than claiming no document changed.
        ...(reviewFiles
          ? {
              reviewFiles: reviewFiles.flatMap((file) => {
                const path = prefix + file.path;
                return owned.has(path) ? [{ ...file, path }] : [];
              }),
            }
          : {}),
      },
    ];
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
    ...(options.pullRequests ? { pullRequests } : {}),
  };
}
