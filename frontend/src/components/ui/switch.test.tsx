// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Label } from './label';
import { Switch } from './switch';

test('a switch is named by its label and toggles', () => {
  const onCheckedChange = vi.fn();
  render(
    <>
      <Switch id="auto" onCheckedChange={onCheckedChange} />
      <Label htmlFor="auto">Auto-start when a set is done</Label>
    </>,
  );
  const control = screen.getByRole('switch', {
    name: 'Auto-start when a set is done',
  });
  expect(control).not.toBeChecked();
  fireEvent.click(control);
  expect(control).toBeChecked();
  expect(onCheckedChange).toHaveBeenCalledWith(true);
});

test('a disabled switch does not toggle', () => {
  render(<Switch aria-label="Notifications" disabled />);
  const control = screen.getByRole('switch', { name: 'Notifications' });
  fireEvent.click(control);
  expect(control).not.toBeChecked();
});
