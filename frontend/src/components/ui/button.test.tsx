// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Button } from './button';

test('a button is reachable by its name and reports clicks', () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Save</Button>);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onClick).toHaveBeenCalledOnce();
});

test('a disabled button ignores clicks', () => {
  const onClick = vi.fn();
  render(
    <Button disabled onClick={onClick}>
      Save
    </Button>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onClick).not.toHaveBeenCalled();
});

test('variants and sizes change the classes, and touch screens get 44px', () => {
  render(
    <>
      <Button variant="destructive">Delete</Button>
      <Button variant="outline" size="icon" aria-label="Close" />
    </>,
  );
  expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-destructive', 'pointer-coarse:min-h-11');
  expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('border', 'pointer-coarse:size-11');
});

test('asChild renders the child element, e.g. a link', () => {
  render(
    <Button asChild>
      <a href="/journal">Journal</a>
    </Button>,
  );
  expect(screen.getByRole('link', { name: 'Journal' })).toHaveAttribute('data-slot', 'button');
});
