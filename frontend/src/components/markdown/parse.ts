// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/markdown/
// A small Markdown parser for user-written text (#19). It builds a tree of plain data, never HTML, so the renderer
// can only create React elements for the syntax listed in markdown.md and nothing a writer types can inject markup or
// script. Anything the parser does not know stays as plain text. No dependencies.
import { safeWebUrl } from '../external-link/web-link';

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

const fence = /^```/;
const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const rule = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const quote = /^\s{0,3}>\s?/;
const bullet = /^\s{0,3}[-*+]\s+(.*)$/;
const numbered = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;

/** Splits text into blocks: headings (# to ####), paragraphs, quotes, flat lists, fenced code and rules. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (fence.test(line.trim())) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !fence.test((lines[i] ?? '').trim())) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // the closing fence (an unclosed fence runs to the end)
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const head = heading.exec(line);
    if (head) {
      blocks.push({
        type: 'heading',
        level: (head[1] ?? '#').length as 1 | 2 | 3 | 4,
        children: parseInline(head[2] ?? ''),
      });
      i += 1;
      continue;
    }
    if (rule.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (quote.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && quote.test(lines[i] ?? '')) {
        inner.push((lines[i] ?? '').replace(quote, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner.join('\n')) });
      continue;
    }
    const kind = bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
    if (kind) {
      const items: Inline[][] = [];
      while (i < lines.length && kind.test(lines[i] ?? '')) {
        items.push(parseInline(kind.exec(lines[i] ?? '')?.[1] ?? ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: kind === numbered, items });
      continue;
    }
    const text: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines[i] ?? '')) {
      text.push((lines[i] ?? '').trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(text.join('\n')) });
  }
  return blocks;
}

function startsBlock(line: string) {
  return (
    fence.test(line.trim()) ||
    heading.test(line) ||
    rule.test(line) ||
    quote.test(line) ||
    bullet.test(line) ||
    numbered.test(line)
  );
}

/** Inline syntax: `code`, **strong**, *em* or _em_, [text](https://url). A new line inside a paragraph is a line break. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const ch = source[i] ?? '';
    if (ch === '\\' && i + 1 < source.length && /[\\`*_[\]()#>-]/.test(source[i + 1] ?? '')) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ type: 'break' });
      i += 1;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/.exec(rest);
    if (strong) {
      flush();
      out.push({ type: 'strong', children: parseInline(strong[2] ?? '') });
      i += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?=\S)([^*_\n]+?)(?<=\S)\1/.exec(rest);
    if (em && (ch === '*' || !/\w/.test(source[i - 1] ?? ''))) {
      flush();
      out.push({ type: 'em', children: parseInline(em[2] ?? '') });
      i += em[0].length;
      continue;
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeWebUrl(link[2] ?? '');
      flush();
      // An address that is not http(s) keeps its text and drops the link.
      if (href) out.push({ type: 'link', href, children: parseInline(link[1] ?? '') });
      else out.push(...parseInline(link[1] ?? ''));
      i += link[0].length;
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}
