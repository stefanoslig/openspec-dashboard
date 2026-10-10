import type { Artifact, Change } from '../../../../cli/workspace/model.ts';

export interface OutlineEntry {
  path: string;
  label: string;
  note?: string;
}
export interface OutlineGroup {
  title: string;
  entries: OutlineEntry[];
}

/** The capability of a spec document, from its path under a change or the openspec folder. */
export const capabilityOf = (path: string) => /^specs\/(.+)\/spec\.md$/.exec(path)?.[1];

const titles = ['In this change', 'Spec changes', 'Other files'] as const;

/** Where the outline lists a document of a change, and how; `relative` is its path within the change. */
function entryOf(
  doc: Artifact,
  relative: string,
): { title: (typeof titles)[number]; entry: OutlineEntry } {
  const capability = capabilityOf(relative);
  if (capability !== undefined)
    return { title: 'Spec changes', entry: { path: doc.path, label: capability } };
  if (doc.format === 'yaml')
    return { title: 'Other files', entry: { path: doc.path, label: relative } };
  const note = doc.total ? { note: doc.completed + ' / ' + doc.total } : {};
  return { title: 'In this change', entry: { path: doc.path, label: doc.title, ...note } };
}

/** The documents of a change, grouped the way the outline lists them. */
export function outlineOf(change: Change, documents: Artifact[]): OutlineGroup[] {
  const byPath = new Map(documents.map((doc) => [doc.path, doc]));
  const entries = change.documents
    .map((path) => byPath.get(path))
    .filter((doc) => doc !== undefined)
    .map((doc) => entryOf(doc, doc.path.slice(change.id.length + 1)));
  return titles
    .map((title) => ({
      title,
      entries: entries.filter((item) => item.title === title).map((item) => item.entry),
    }))
    .filter((group) => group.entries.length);
}

/** The published specifications, as the outline lists them beside one of them. */
export function outlineOfSpecs(documents: Artifact[]): OutlineGroup[] {
  const entries = documents.flatMap((doc) => {
    const capability = capabilityOf(doc.path);
    return capability === undefined ? [] : [{ path: doc.path, label: capability }];
  });
  return [{ title: 'Specifications', entries }];
}

/** The loose files of the openspec folder: outside specs and changes, and not from a pull request. */
export function outlineOfWorkspace(documents: Artifact[]): OutlineGroup[] {
  const entries = documents
    .filter((doc) => doc.pullRequest === undefined && !/^(specs|changes)\//.test(doc.path))
    .map((doc) => ({ path: doc.path, label: doc.path }));
  return [{ title: 'Workspace files', entries }];
}

export interface Neighbours {
  previous?: OutlineEntry;
  next?: OutlineEntry;
}

/** The entries listed before and after the document at `path`; neither when it is not listed. */
export function neighboursOf(groups: OutlineGroup[], path: string): Neighbours {
  const entries = groups.flatMap((group) => group.entries);
  const index = entries.findIndex((entry) => entry.path === path);
  if (index < 0) return {};
  return { previous: entries[index - 1], next: entries[index + 1] };
}
