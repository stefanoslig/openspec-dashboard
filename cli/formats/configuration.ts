import { isMap, isScalar, parseAllDocuments, type Scalar } from 'yaml';
import type { Artifact } from '../workspace/model.ts';

const scalarText = (node: Scalar) =>
  typeof node.source === 'string' ? node.source : String(node.value ?? '');
/** The text of a scalar value; a mapping, a sequence or a missing value has none. */
const valueText = (node: unknown) => (isScalar(node) ? scalarText(node) : null);

/** Top-level scalar keys of a YAML mapping. Throws when the YAML is invalid. */
export function configuration(content: string): Map<string, string | null> {
  const documents = parseAllDocuments(content);
  const error = documents.find((document) => document.errors.length)?.errors[0];
  if (error) throw error;
  const settings = new Map<string, string | null>();
  const root = documents[0]?.contents;
  if (!isMap(root)) return settings;
  for (const { key, value } of root.items)
    if (isScalar(key)) settings.set(scalarText(key), valueText(value));
  return settings;
}

/** The workspace schema from `config.yaml`; a broken file and an external store each warn. */
export function workspaceSettings(documents: Artifact[]): { schema: string; warnings: string[] } {
  const content = documents.find((doc) => /^config\.ya?ml$/.test(doc.path))?.content ?? '';
  const warnings: string[] = [];
  let settings = new Map<string, string | null>();
  try {
    settings = configuration(content);
  } catch {
    warnings.push('config.yaml could not be parsed. Its source is still available in Artifacts.');
  }
  if (settings.has('store'))
    warnings.push(
      'This project declares an external OpenSpec store. Connect to that store repository to read its artifacts; store registration is not resolved automatically.',
    );
  return { schema: settings.get('schema') ?? 'spec-driven', warnings };
}
