import { Marked } from 'marked';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function renderMarkdown(content: string): {
  html: string;
  headings: { id: string; text: string; depth: number }[];
} {
  const headings: { id: string; text: string; depth: number }[] = [];
  const used = new Map<string, number>();
  const parser = new Marked({
    gfm: true,
    renderer: {
      checkbox({ checked }) {
        return (
          '<span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="' +
          checked +
          '" aria-label="' +
          (checked ? 'Completed task' : 'Incomplete task') +
          '">' +
          (checked ? '✓' : '') +
          '</span>'
        );
      },
      heading({ tokens, depth, text }) {
        const base =
          text
            .toLowerCase()
            .replace(/<[^>]*>/g, '')
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .trim()
            .replace(/\s+/g, '-') || 'section';
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const id = count ? base + '-' + count : base;
        headings.push({ id, text: text.replace(/[*`]/g, ''), depth });
        return (
          '<h' + depth + ' id="' + id + '">' + this.parser.parseInline(tokens) + '</h' + depth + '>'
        );
      },
      html({ text }) {
        return escape(text);
      },
      image({ text }) {
        return '<span class="image-placeholder">[Image: ' + escape(text) + ']</span>';
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href)) return label;
        const external = /^(https?:|mailto:)/i.test(href);
        return (
          '<a href="' +
          escape(href) +
          '"' +
          (external ? ' target="_blank" rel="noopener noreferrer"' : '') +
          '>' +
          label +
          '</a>'
        );
      },
    },
  });
  return { html: parser.parse(content, { async: false }), headings };
}
