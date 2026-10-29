// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Checkbox } from './checkbox';
import { Label } from './label';

test('a checkbox is named by its label and toggles', () => {
  const onCheckedChange = vi.fn();
  render(
    <div className="flex items-center gap-2">
      <Checkbox id="done" onCheckedChange={onCheckedChange} />
      <Label htmlFor="done">완료</Label>
    </div>,
  );
  const box = screen.getByRole('checkbox', { name: '완료' });
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  expect(box).toBeChecked();
  expect(onCheckedChange).toHaveBeenCalledWith(true);
});

test('a disabled checkbox does not toggle', () => {
  render(<Checkbox aria-label="알림" disabled />);
  const box = screen.getByRole('checkbox', { name: '알림' });
  fireEvent.click(box);
  expect(box).not.toBeChecked();
});
