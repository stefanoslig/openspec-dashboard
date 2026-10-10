/** A link to the web, which opens outside the workspace. */
export const isWebLink = (href: string) => /^(https?:|mailto:)/i.test(href);

// A made-up origin to resolve links against: the ones that stay inside it stay in the workspace.
const origin = 'https://workspace.local';

/**
 * Where a relative link in the document at `from` leads: a workspace path and a fragment, or null
 * when the link leaves the workspace. A pull request document may link to a document of the
 * published branch: when only the published path is among `paths`, the loaded documents, that is
 * the one taken. The path returned may still be unknown; the caller decides what to do then.
 */
export function linkedDocument(
  href: string,
  from: string,
  paths: string[],
): { path: string; fragment: string } | null {
  const resolved = new URL(href, `${origin}/openspec/${from}`);
  if (resolved.origin !== origin) return null;
  const path = decodeURIComponent(resolved.pathname.replace(/^\/openspec\//, ''));
  const published = path.replace(/^\.pulls\/\d+\//, '');
  return {
    path: !paths.includes(path) && paths.includes(published) ? published : path,
    fragment: decodeURIComponent(resolved.hash.slice(1)),
  };
}

/** Where a link of a document leads. */
export type LinkTarget =
  // The browser handles it, in a new tab.
  | { kind: 'web' }
  | { kind: 'heading'; fragment: string }
  | { kind: 'document'; path: string; fragment: string }
  // A workspace document that is not among the loaded ones.
  | { kind: 'missing'; path: string }
  // Leaves the workspace altogether.
  | { kind: 'outside' }
  // Cannot be read, for instance with a stray percent sign.
  | { kind: 'broken' };

/** Tells where a link in the document at `from` leads; `paths` are the loaded documents. */
export function linkTarget(href: string, from: string, paths: string[]): LinkTarget {
  if (isWebLink(href)) return { kind: 'web' };
  try {
    if (href.startsWith('#'))
      return { kind: 'heading', fragment: decodeURIComponent(href.slice(1)) };
    const target = linkedDocument(href, from, paths);
    if (target === null) return { kind: 'outside' };
    if (!paths.includes(target.path)) return { kind: 'missing', path: target.path };
    return { kind: 'document', path: target.path, fragment: target.fragment };
  } catch {
    return { kind: 'broken' };
  }
}
