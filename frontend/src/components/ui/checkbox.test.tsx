// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Checkbox } from './checkbox';
import { Label } from './label';

test('a checkbox is named by its label and toggles', () => {
  const onCheckedChange = vi.fn();
  render(
    <div className="flex items-center gap-2">
      <Checkbox id="done" onCheckedChange={onCheckedChange} />
      <Label htmlFor="done">Done</Label>
    </div>,
  );
  const box = screen.getByRole('checkbox', { name: 'Done' });
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  expect(box).toBeChecked();
  expect(onCheckedChange).toHaveBeenCalledWith(true);
});

test('touch screens get a 44px tap area around the 16px box', () => {
  render(<Checkbox aria-label="Alerts" />);
  // 15px outside the content box inside the 1px border: (16 - 2) + 15 × 2 = 44px (#415).
  expect(screen.getByRole('checkbox', { name: 'Alerts' })).toHaveClass('size-4', 'border', 'pointer-coarse:after:-inset-[15px]');
});

test('a disabled checkbox does not toggle', () => {
  render(<Checkbox aria-label="Alerts" disabled />);
  const box = screen.getByRole('checkbox', { name: 'Alerts' });
  fireEvent.click(box);
  expect(box).not.toBeChecked();
});
