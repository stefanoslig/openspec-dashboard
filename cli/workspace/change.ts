import { humanize, isoDate, ordinal } from './artifact.ts';
import { configuration } from '../formats/configuration.ts';
import { pullRequestPrefix } from './pull-request.ts';
import { deltasOf, type Published } from './spec-delta.ts';
import type { Artifact, Change, PullRequestInput } from './model.ts';

/** What the changes of a workspace share. */
export interface ChangeContext {
  /** The workspace schema, for a change whose metadata declares none. */
  schema: string;
  /** Epoch milliseconds of the files on disk by path. */
  modified: Map<string, number | null>;
  published: Published;
}
/** The changes of one source. Times are epochs: their ISO form loses sub-millisecond order. */
export interface ChangeSet {
  changes: Change[];
  times: Map<string, number | null>;
  warnings: string[];
}
/** A change with the epoch its `modified` came from. */
interface DatedChange {
  change: Change;
  time: number | null;
  /** Set when the change's metadata could not be read. */
  warning?: string;
}

const order = ['refine.md', 'proposal.md', 'design.md', 'tasks.md'];
const nameOf = (id: string) => id.slice(id.lastIndexOf('/') + 1);

/** Groups documents into changes. The documents of a pull request share a path prefix. */
function groupsOf(docs: Artifact[], prefix: string): Map<string, Artifact[]> {
  const groups = new Map<string, Artifact[]>();
  for (const doc of docs) {
    const parts = doc.path.slice(prefix.length).split('/');
    const depth = parts[1] === 'archive' ? 3 : 2;
    if (parts[0] !== 'changes' || parts.length <= depth) continue;
    const id = prefix + parts.slice(0, depth).join('/');
    groups.set(id, [...(groups.get(id) ?? []), doc]);
  }
  return groups;
}

/** A change's own schema from its `.openspec.yaml`, else the workspace's; invalid metadata warns. */
function schemaOf(
  id: string,
  docs: Artifact[],
  fallback: string,
): { schema: string; warning?: string } {
  const metadata = docs.find((doc) => doc.path === id + '/.openspec.yaml')?.content ?? '';
  try {
    return { schema: configuration(metadata).get('schema') ?? fallback };
  } catch {
    return { schema: fallback, warning: `Invalid metadata in ${nameOf(id)}.` };
  }
}

/** The newest time of a change: its pull request's update, else the newest of its files. */
function timeOf(
  docs: Artifact[],
  modified: Map<string, number | null>,
  pull?: PullRequestInput,
): number | null {
  const times = pull
    ? [Date.parse(pull.updatedAt)].filter((time) => !Number.isNaN(time))
    : docs.map((doc) => modified.get(doc.path)).filter((time) => time != null);
  return times.length ? Math.max(...times) : null;
}

export function statusOf(completed: number, total: number): Change['status'] {
  if (total === 0) return 'Draft';
  if (completed === total) return 'Complete';
  if (completed > 0) return 'In progress';
  return 'Planned';
}

/** The paths of a change's documents: the main ones in reading order, then the rest by path. */
function documentPaths(id: string, docs: Artifact[]): string[] {
  const rank = (doc: Artifact) => {
    const index = order.indexOf(doc.path.slice(id.length + 1));
    return index < 0 ? 10 : index;
  };
  return [...docs]
    .sort((a, b) => rank(a) - rank(b) || ordinal(a.path, b.path))
    .map((doc) => doc.path);
}

function changeOf(
  [id, docs]: [string, Artifact[]],
  context: ChangeContext,
  pull?: PullRequestInput,
): DatedChange {
  const name = nameOf(id);
  const { schema, warning } = schemaOf(id, docs, context.schema);
  const time = timeOf(docs, context.modified, pull);
  const tasks = docs.find((doc) => doc.path === id + '/tasks.md');
  const proposal = docs.find((doc) => doc.path === id + '/proposal.md');
  const { completed, total } = tasks ?? { completed: 0, total: 0 };
  // Until it merges a change is in review, also when its pull request has archived it already.
  const archived = !pull && id.startsWith('changes/archive/');
  const change: Change = {
    id,
    name,
    title: humanize(name),
    archived,
    schema,
    status: statusOf(completed, total),
    completed,
    total,
    summary: proposal ? proposal.summary : 'Open this change to explore its artifacts.',
    modified: isoDate(time),
    documents: documentPaths(id, docs),
    // An archived change is already in the published specs, so the text it replaced is gone.
    deltas: archived ? [] : deltasOf(id, docs, context.published),
    ...(pull ? { pullRequest: pull.number } : {}),
  };
  return { change, time, warning };
}

/** The changes among the documents; those of a pull request are read under its prefix. */
export function changesOf(
  docs: Artifact[],
  context: ChangeContext,
  pull?: PullRequestInput,
): ChangeSet {
  const prefix = pull ? pullRequestPrefix(pull.number) : '';
  const set: ChangeSet = { changes: [], times: new Map(), warnings: [] };
  for (const group of groupsOf(docs, prefix)) {
    const { change, time, warning } = changeOf(group, context, pull);
    set.changes.push(change);
    set.times.set(change.id, time);
    if (warning) set.warnings.push(warning);
  }
  return set;
}

/** The change sets of several sources as one, in their order. */
export function mergedChanges(sets: ChangeSet[]): ChangeSet {
  return {
    changes: sets.flatMap((set) => set.changes),
    times: new Map(sets.flatMap((set) => [...set.times])),
    warnings: sets.flatMap((set) => set.warnings),
  };
}

// Newest first; changes without a date come last, ties by id.
export function newestFirst(changes: Change[], times: Map<string, number | null>): Change[] {
  const time = (change: Change) => times.get(change.id) ?? Number.NEGATIVE_INFINITY;
  return [...changes].sort((a, b) => {
    if (time(a) === time(b)) return ordinal(a.id, b.id);
    return time(a) < time(b) ? 1 : -1;
  });
}
