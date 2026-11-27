// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, expect, test, vi } from 'vitest';

import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

// jsdom lacks pointer capture and scrolling, which Radix Select calls.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

function Period({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <>
      <Label htmlFor="period">Period</Label>
      <Select onValueChange={onValueChange}>
        <SelectTrigger id="period">
          <SelectValue placeholder="Select period" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="week">1 week</SelectItem>
          <SelectItem value="month">1 month</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

test('the trigger is a named combobox that shows the placeholder', () => {
  render(<Period />);
  const trigger = screen.getByRole('combobox', { name: 'Period' });
  expect(trigger).toHaveTextContent('Select period');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('the keyboard opens the list and picks an option', async () => {
  const onValueChange = vi.fn();
  render(<Period onValueChange={onValueChange} />);
  const trigger = screen.getByRole('combobox', { name: 'Period' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  // Arrow keys move through the options and Enter picks the focused one; no pointer events.
  await waitFor(() => expect(screen.getByRole('option', { name: '1 week' })).toHaveFocus());
  fireEvent.keyDown(screen.getByRole('option', { name: '1 week' }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getByRole('option', { name: '1 month' })).toHaveFocus());
  fireEvent.keyDown(screen.getByRole('option', { name: '1 month' }), { key: 'Enter' });
  expect(onValueChange).toHaveBeenCalledWith('month');
  expect(trigger).toHaveTextContent('1 month');
});

test('the trigger is 40px tall and 48px on touch screens (#1125)', () => {
  render(<Period />);
  expect(screen.getByRole('combobox', { name: 'Period' })).toHaveClass('data-[size=default]:h-10', 'pointer-coarse:min-h-12');
});

test('the trigger shows a pointer cursor (#1126)', () => {
  render(<Period />);
  expect(screen.getByRole('combobox', { name: 'Period' })).toHaveClass('cursor-pointer', 'disabled:cursor-not-allowed');
});
