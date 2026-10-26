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
      <Label htmlFor="period">기간</Label>
      <Select onValueChange={onValueChange}>
        <SelectTrigger id="period">
          <SelectValue placeholder="기간 선택" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="week">1주</SelectItem>
          <SelectItem value="month">1개월</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

test('the trigger is a named combobox that shows the placeholder', () => {
  render(<Period />);
  const trigger = screen.getByRole('combobox', { name: '기간' });
  expect(trigger).toHaveTextContent('기간 선택');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('the keyboard opens the list and picks an option', () => {
  const onValueChange = vi.fn();
  render(<Period onValueChange={onValueChange} />);
  const trigger = screen.getByRole('combobox', { name: '기간' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('option', { name: '1개월' }));
  expect(onValueChange).toHaveBeenCalledWith('month');
  expect(trigger).toHaveTextContent('1개월');
});
