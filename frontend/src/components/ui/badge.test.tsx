// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Badge } from './badge';

test('badge variants use the shared colour tokens', () => {
  render(
    <>
      <Badge>Default</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="outline">Secondary</Badge>
    </>,
  );
  expect(screen.getByText('Default')).toHaveClass('bg-primary');
  expect(screen.getByText('Warning')).toHaveClass('bg-warning', 'text-warning-foreground');
  expect(screen.getByText('Secondary')).toHaveClass('text-foreground');
});

test('asChild turns a badge into a link', () => {
  render(
    <Badge asChild>
      <a href="/tags/legs">Legs</a>
    </Badge>,
  );
  expect(screen.getByRole('link', { name: 'Legs' })).toHaveAttribute('data-slot', 'badge');
});
