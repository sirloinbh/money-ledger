// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/disclosure/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Disclosure } from './disclosure';

test('the summary names the block and the content is closed until it is opened', () => {
  const { container } = render(<Disclosure summary="Advanced options">Hidden text</Disclosure>);
  const details = container.querySelector('details');
  expect(screen.getByText('Advanced options')).toBeInTheDocument();
  expect(details).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Advanced options'));
  expect(details).toHaveAttribute('open');
});

test('open starts it open and onOpenChange reports a change', () => {
  const onOpenChange = vi.fn();
  const { container } = render(
    <Disclosure summary="Notes" open onOpenChange={onOpenChange}>
      Body
    </Disclosure>,
  );
  const details = container.querySelector('details');
  expect(details).toHaveAttribute('open');
  details?.removeAttribute('open');
  fireEvent(details as Element, new Event('toggle'));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('the summary keeps the touch height, the pointer cursor and the focus ring, and the chevron is hidden from screen readers', () => {
  const { container } = render(<Disclosure summary="Details">Body</Disclosure>);
  const summary = container.querySelector('summary');
  expect(summary).toHaveClass('min-h-11', 'pointer-coarse:min-h-12', 'cursor-pointer');
  expect(summary?.className).toContain('focus-visible:ring-');
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

test('className and rest props reach the root element', () => {
  const { container } = render(
    <Disclosure summary="Extra" className="mt-4" data-testid="box" id="more">
      Body
    </Disclosure>,
  );
  const root = container.querySelector('details');
  expect(root).toHaveClass('mt-4');
  expect(root).toHaveAttribute('id', 'more');
  expect(screen.getByTestId('box')).toBe(root);
});
