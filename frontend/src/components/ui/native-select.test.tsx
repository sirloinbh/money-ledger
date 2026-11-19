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

test('it shares the Input look, reaches 44px on touch screens and can be invalid or disabled', () => {
  render(
    <NativeSelect aria-label="Period" aria-invalid disabled>
      <option>Week</option>
    </NativeSelect>,
  );
  const select = screen.getByRole('combobox', { name: 'Period' });
  expect(select).toHaveClass('border-input', 'pointer-coarse:min-h-11');
  expect(select).toBeInvalid();
  expect(select).toBeDisabled();
});
