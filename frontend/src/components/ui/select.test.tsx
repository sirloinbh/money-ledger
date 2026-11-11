// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen } from '@testing-library/react';
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

test('the keyboard opens the list and picks an option', () => {
  const onValueChange = vi.fn();
  render(<Period onValueChange={onValueChange} />);
  const trigger = screen.getByRole('combobox', { name: 'Period' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('option', { name: '1 month' }));
  expect(onValueChange).toHaveBeenCalledWith('month');
  expect(trigger).toHaveTextContent('1 month');
});
