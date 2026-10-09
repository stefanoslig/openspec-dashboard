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
