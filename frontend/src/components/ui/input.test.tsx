// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Input } from './input';
import { Label } from './label';

test('a label names its input and typing updates the value', () => {
  render(
    <>
      <Label htmlFor="weight">중량</Label>
      <Input id="weight" inputMode="decimal" />
    </>,
  );
  const input = screen.getByLabelText('중량');
  fireEvent.change(input, { target: { value: '42.5' } });
  expect(input).toHaveValue('42.5');
  expect(input).toHaveClass('pointer-coarse:min-h-11');
});

test('aria-invalid marks the input as invalid', () => {
  render(<Input aria-label="이름" aria-invalid />);
  expect(screen.getByRole('textbox', { name: '이름' })).toBeInvalid();
});
