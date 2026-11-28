// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/external-link/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { ExternalLink } from './external-link';
import { safeWebUrl } from './web-link';

test('an https address is a link that opens in a new tab and says so in its name', () => {
  render(<ExternalLink href="https://example.com/docs">Docs</ExternalLink>);
  const link = screen.getByRole('link', { name: 'Docs (opens in a new tab)' });
  expect(link).toHaveAttribute('href', 'https://example.com/docs');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('an address that is not http or https renders as plain text, not a link', () => {
  const { container } = render(
    <>
      <ExternalLink href="javascript:alert(1)">Bad</ExternalLink>
      <ExternalLink href="/relative">Local</ExternalLink>
      <ExternalLink href="not a url">Text</ExternalLink>
    </>,
  );
  expect(screen.queryByRole('link')).toBeNull();
  expect(container).toHaveTextContent('BadLocalText');
});

test('the link keeps the touch height, the pointer cursor and the focus ring; className is merged', () => {
  render(
    <ExternalLink href="https://example.com" className="mt-2">
      Site
    </ExternalLink>,
  );
  const link = screen.getByRole('link');
  expect(link).toHaveClass('min-h-11', 'pointer-coarse:min-h-12', 'cursor-pointer', 'mt-2');
  expect(link.className).toContain('focus-visible:ring-');
  expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

test('safeWebUrl accepts only absolute http and https addresses', () => {
  expect(safeWebUrl(' https://example.com ')).toBe('https://example.com/');
  expect(safeWebUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
  expect(safeWebUrl('ftp://example.com')).toBeNull();
  expect(safeWebUrl('data:text/html,hi')).toBeNull();
  expect(safeWebUrl('')).toBeNull();
});
