/** The content as plain words: no task markers, Markdown punctuation or runs of white space. */
const plainText = (content: string) =>
  content
    .replace(/^\s*[-*] \[[ x]\] /gim, '')
    .replace(/[#*`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The text around the first match of any of the `terms`, split so the matching words can be marked. */
export function excerpt(content: string, terms: string[]): { text: string; hit: boolean }[] {
  const plain = plainText(content);
  const lower = plain.toLocaleLowerCase();
  const at = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  if (!Number.isFinite(at)) return [];
  const start = at > 70 ? plain.indexOf(' ', at - 70) + 1 : 0;
  const end = at + 180;
  const pattern = new RegExp(
    '(' + terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'gi',
  );
  return ((start ? '… ' : '') + plain.slice(start, end) + (end < plain.length ? '…' : ''))
    .split(pattern)
    .filter(Boolean)
    .map((text) => ({ text, hit: terms.includes(text.toLocaleLowerCase()) }));
}
