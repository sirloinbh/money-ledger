// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/markdown/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Markdown } from './markdown';
import { parseBlocks, parseInline } from './parse';

// The supported syntax (markdown.md) has one test per row.

test('headings: # becomes h2 by default and the level can start lower', () => {
  const { rerender } = render(<Markdown>{'# One\n\n## Two\n\n#### Four'}</Markdown>);
  expect(screen.getByRole('heading', { level: 2, name: 'One' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Two' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 5, name: 'Four' })).toBeInTheDocument();
  rerender(<Markdown headingStart={3}>{'# One'}</Markdown>);
  expect(screen.getByRole('heading', { level: 3, name: 'One' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
});

test('paragraphs split on a blank line and a new line is a line break', () => {
  const { container } = render(<Markdown>{'first\nsecond\n\nthird'}</Markdown>);
  const paragraphs = container.querySelectorAll('p');
  expect(paragraphs).toHaveLength(2);
  expect(paragraphs[0]?.querySelectorAll('br')).toHaveLength(1);
});

test('strong, emphasis and inline code', () => {
  const { container } = render(<Markdown>{'**bold** and *soft* and _also_ and `x < y`'}</Markdown>);
  expect(container.querySelector('strong')).toHaveTextContent('bold');
  expect(container.querySelectorAll('em')).toHaveLength(2);
  expect(container.querySelector('code')).toHaveTextContent('x < y');
});

test('snake_case words are not emphasis', () => {
  expect(parseInline('my_file_name')).toEqual([{ type: 'text', text: 'my_file_name' }]);
});

test('bullet and numbered lists', () => {
  render(<Markdown>{'- a\n- b\n\n1. one\n2. two'}</Markdown>);
  const lists = screen.getAllByRole('list');
  expect(lists).toHaveLength(2);
  expect(lists[0]?.tagName).toBe('UL');
  expect(lists[1]?.tagName).toBe('OL');
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
});

test('block quote', () => {
  const { container } = render(<Markdown>{'> quoted **text**'}</Markdown>);
  expect(container.querySelector('blockquote strong')).toHaveTextContent('text');
});

test('fenced code keeps its text exactly and ignores Markdown inside', () => {
  const { container } = render(<Markdown>{'```\n# not a heading\n**no**\n```'}</Markdown>);
  expect(container.querySelector('pre code')?.textContent).toBe('# not a heading\n**no**');
  expect(container.querySelector('strong')).toBeNull();
});

test('an unclosed fence runs to the end', () => {
  expect(parseBlocks('```\ncode')).toEqual([{ type: 'code', text: 'code' }]);
});

test('horizontal rule', () => {
  const { container } = render(<Markdown>{'a\n\n---\n\nb'}</Markdown>);
  expect(container.querySelector('hr')).toBeInTheDocument();
});

test('links: https opens in a new tab with a screen reader hint', () => {
  render(<Markdown>{'[docs](https://example.com/a?b=1)'}</Markdown>);
  const link = screen.getByRole('link', { name: 'docs (opens in a new tab)' });
  expect(link).toHaveAttribute('href', 'https://example.com/a?b=1');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('links that are not http(s) lose the link and keep the text', () => {
  const { container } = render(
    <Markdown>{'[a](javascript:alert(1)) [b](data:text/html,x) [c](/relative)'}</Markdown>,
  );
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(container.textContent).toContain('a');
  expect(container.textContent).not.toContain('javascript');
});

test('raw HTML and images are shown as text, never as elements', () => {
  const { container } = render(
    <Markdown>
      {'<script>alert(1)</script> <img src=x onerror=alert(1)> ![alt](https://example.com/x.png)'}
    </Markdown>,
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<script>alert(1)</script>');
});

test('a backslash escapes a Markdown character', () => {
  const { container } = render(<Markdown>{'\\*not italic\\*'}</Markdown>);
  expect(container.querySelector('em')).toBeNull();
  expect(container.textContent).toBe('*not italic*');
});

test('empty text renders an empty container', () => {
  const { container } = render(<Markdown>{''}</Markdown>);
  expect(container.firstElementChild).toBeEmptyDOMElement();
});
