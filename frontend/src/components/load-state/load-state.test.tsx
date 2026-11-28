// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/load-state/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { LoadFailed, LoadingRegion, RetryButton } from './load-state';

test('a loading region is a named, busy status with hidden placeholder shapes', () => {
  const { container } = render(<LoadingRegion label="Loading entries" />);
  const region = screen.getByRole('status', { name: 'Loading entries' });
  expect(region).toHaveAttribute('aria-busy', 'true');
  expect(
    container.querySelectorAll('[data-slot="skeleton"][aria-hidden="true"]').length,
  ).toBeGreaterThan(0);
});

test('the shape and the number of rows or cards can be chosen', () => {
  const { container, rerender } = render(<LoadingRegion label="Loading" shape="rows" rows={4} />);
  expect(container.querySelectorAll('[data-slot="skeleton-list"] > div')).toHaveLength(4);
  rerender(<LoadingRegion label="Loading" shape="card" />);
  expect(container.querySelectorAll('[data-slot="skeleton-card"]')).toHaveLength(1);
  rerender(<LoadingRegion label="Loading" shape="cards" rows={2} />);
  expect(container.querySelectorAll('[data-slot="skeleton-card"]')).toHaveLength(2);
});

test('a failed load is announced and its retry calls onRetry', () => {
  const onRetry = vi.fn();
  render(<LoadFailed message="Entries could not be loaded." onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Entries could not be loaded.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('without onRetry the message is shown alone, and a custom retry label is used', () => {
  const { rerender } = render(<LoadFailed message="Gone." />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<LoadFailed message="Gone." onRetry={() => {}} retryLabel="Reload" />);
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
});

test('while retrying the button stays focusable, shows a spinner and ignores clicks', () => {
  const onRetry = vi.fn();
  render(<RetryButton onRetry={onRetry} pending />);
  const button = screen.getByRole('button', { name: /Try again/ });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  expect(screen.getByRole('status', { name: 'Trying again' })).toBeInTheDocument();
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(onRetry).not.toHaveBeenCalled();
});

test('when the focused retry button leaves the page, focus moves to the nearest named region', () => {
  const { rerender } = render(
    <main>
      <section aria-label="Entries">
        <RetryButton onRetry={() => {}} />
      </section>
    </main>,
  );
  screen.getByRole('button', { name: 'Try again' }).focus();
  rerender(
    <main>
      <section aria-label="Entries">
        <p>Loaded</p>
      </section>
    </main>,
  );
  expect(screen.getByRole('region', { name: 'Entries' })).toHaveFocus();
});

test('without a named region focus goes to main, and an unfocused button moves nothing', () => {
  const { rerender } = render(
    <main>
      <RetryButton onRetry={() => {}} />
    </main>,
  );
  screen.getByRole('button', { name: 'Try again' }).focus();
  rerender(<main>Done</main>);
  expect(screen.getByRole('main')).toHaveFocus();

  rerender(
    <main>
      <RetryButton onRetry={() => {}} />
    </main>,
  );
  (document.activeElement as HTMLElement).blur();
  rerender(<main>Done again</main>);
  expect(screen.getByRole('main')).not.toHaveFocus();
});
