// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Label } from './label';
import { NativeSelect } from './native-select';

test('a label names the select and choosing an option reports it', () => {
  const onChange = vi.fn();
  render(
    <>
      <Label htmlFor="unit">Unit</Label>
      <NativeSelect id="unit" defaultValue="kg" onChange={onChange}>
        <option value="kg">kg</option>
        <option value="lb">lb</option>
      </NativeSelect>
    </>,
  );
  const select = screen.getByRole('combobox', { name: 'Unit' });
  expect(select).toHaveValue('kg');
  fireEvent.change(select, { target: { value: 'lb' } });
  expect(select).toHaveValue('lb');
  expect(onChange).toHaveBeenCalledOnce();
});

test('it shares the Input look, reaches 48px on touch screens and can be invalid or disabled', () => {
  render(
    <NativeSelect aria-label="Period" aria-invalid disabled>
      <option>Week</option>
    </NativeSelect>,
  );
  const select = screen.getByRole('combobox', { name: 'Period' });
  expect(select).toHaveClass('border-input', 'h-10', 'pointer-coarse:min-h-12');
  expect(select).toBeInvalid();
  expect(select).toBeDisabled();
});

test('a native select shows a pointer cursor (#1126)', () => {
  render(<NativeSelect aria-label="Sort"><option>a</option></NativeSelect>);
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveClass('cursor-pointer');
});

test('the open list has solid popover colors so dark mode stays readable (#60)', () => {
  render(<NativeSelect aria-label="Sort"><option>a</option></NativeSelect>);
  const select = screen.getByRole('combobox', { name: 'Sort' });
  expect(select).toHaveClass('[&_option]:bg-popover', '[&_option]:text-popover-foreground', '[&_optgroup]:bg-popover');
  expect(select).toHaveClass('bg-transparent');
});
