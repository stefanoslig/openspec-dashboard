import {
  parseDelta,
  publishedRequirements,
  type Delta,
  type Rename,
  type RequirementBlock,
} from '../formats/delta.ts';
import type { Artifact, RequirementChange, SpecDelta } from './model.ts';

/** A published spec: its path and the text of its requirements by name. */
export type Published = (
  capability: string,
) => { path: string; requirements: Map<string, string> } | undefined;
/** The published text of a requirement by name, or null when the spec has none. */
type Previous = (name: string) => string | null;

function specAt(documents: Artifact[], path: string): ReturnType<Published> {
  const spec = documents.find((doc) => doc.path === path);
  if (!spec) return undefined;
  const blocks = publishedRequirements(spec.content);
  return { path, requirements: new Map(blocks.map((block) => [block.name, block.text])) };
}

/** Looks published specs up by capability, reading the requirements of each spec once. */
export function publishedSpecs(documents: Artifact[]): Published {
  const specs = new Map<string, ReturnType<Published>>();
  return (capability) => {
    const path = 'specs/' + capability + '/spec.md';
    if (!specs.has(path)) specs.set(path, specAt(documents, path));
    return specs.get(path);
  };
}

/** An added or removed requirement; the published text is the one under the same name. */
function sameNameChange(
  kind: 'added' | 'removed',
  block: RequirementBlock,
  previous: Previous,
): RequirementChange {
  return { kind, ...block, previous: previous(block.name) };
}

function modifiedChange(
  block: RequirementBlock,
  rename: Rename | undefined,
  previous: Previous,
): RequirementChange {
  return {
    kind: 'modified',
    ...block,
    ...(rename ? { previousName: rename.from } : {}),
    previous: previous(rename?.from ?? block.name),
  };
}

function renamedChange(rename: Rename, previous: Previous): RequirementChange {
  return {
    kind: 'renamed',
    name: rename.to,
    previousName: rename.from,
    text: '',
    previous: previous(rename.from),
    line: rename.line,
    endLine: rename.endLine,
  };
}

/** The requirement changes of one delta spec, by line. */
function requirementChanges(delta: Delta, previous: Previous): RequirementChange[] {
  const added = delta.added.map((block) => sameNameChange('added', block, previous));
  const removed = delta.removed.map((block) => sameNameChange('removed', block, previous));
  // OpenSpec renames before it modifies, so a renamed requirement is modified under its new name.
  // A rename no modification claims is reported on its own.
  const renames = new Map(delta.renamed.map((rename) => [rename.to, rename]));
  const modified = delta.modified.map((block) => {
    const rename = renames.get(block.name);
    renames.delete(block.name);
    return modifiedChange(block, rename, previous);
  });
  const renamed = [...renames.values()].map((rename) => renamedChange(rename, previous));
  return [...added, ...modified, ...removed, ...renamed].sort((a, b) => a.line - b.line);
}

/** The delta of one document: none when it is not a delta spec or changes no requirement. */
function deltaOf(id: string, doc: Artifact, published: Published): SpecDelta[] {
  const capability = /^specs\/(.+)\/spec\.md$/.exec(doc.path.slice(id.length + 1))?.[1];
  if (!capability) return [];
  const spec = published(capability);
  const previous: Previous = (name) => spec?.requirements.get(name) ?? null;
  const requirements = requirementChanges(parseDelta(doc.content), previous);
  if (!requirements.length) return [];
  return [{ path: doc.path, capability, published: spec ? spec.path : null, requirements }];
}

/** What the delta specs of a change do to the requirements of the published specs. */
export function deltasOf(id: string, docs: Artifact[], published: Published): SpecDelta[] {
  return docs.flatMap((doc) => deltaOf(id, doc, published));
}
