// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { AlertBanner } from './alert-banner';
import { Button } from './button';

test('the banner is announced as an alert and keeps its action inside', () => {
  const onRetry = vi.fn();
  render(
    <AlertBanner
      action={
        <Button type="button" onClick={onRetry}>
          Reconnect
        </Button>
      }
    >
      Storage connection failed
    </AlertBanner>,
  );
  const alert = screen.getByRole('alert');
  expect(alert).toHaveAttribute('data-slot', 'alert-banner');
  expect(alert).toHaveTextContent('Storage connection failed');
  fireEvent.click(within(alert).getByRole('button', { name: 'Reconnect' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

test('a banner without an action shows only its message, and className adds to the box', () => {
  render(<AlertBanner className="mb-0">Local storage error</AlertBanner>);
  const alert = screen.getByRole('alert');
  expect(within(alert).queryByRole('button')).toBeNull();
  expect(alert).toHaveClass('mb-0', 'border-l-destructive');
});
