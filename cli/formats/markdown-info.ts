import { lexer, type Token, type Tokens } from 'marked';

export interface MarkdownInfo {
  completed: number;
  total: number;
  requirements: number;
  scenarios: number;
  summary: string;
}

/** The token lists under a token: the items of a list, the cells of a table, else its own tokens. */
function nestedTokens(token: Tokens.Generic): Token[][] {
  if (token.type === 'list') return [token['items']];
  if (token.type === 'table')
    return [...token['header'], ...token['rows'].flat()].map((cell) => cell.tokens);
  return token.tokens ? [token.tokens] : [];
}

function walk(tokens: Token[], visit: (token: Tokens.Generic) => void): void {
  for (const token of tokens as Tokens.Generic[]) {
    visit(token);
    for (const nested of nestedTokens(token)) walk(nested, visit);
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
