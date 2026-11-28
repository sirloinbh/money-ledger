// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/toggle-chips/
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { ToggleChips } from './toggle-chips';

const options = [
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'legs', label: 'Legs', disabled: true },
];

test('single is a named radio group, one chip is checked, and clicking the checked chip clears it', () => {
  const onValueChange = vi.fn();
  render(
    <ToggleChips
      aria-label="Split"
      options={options}
      defaultValue="push"
      onValueChange={onValueChange}
    />,
  );
  expect(screen.getByRole('radiogroup', { name: 'Split' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Push' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Pull' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Pull' }));
  expect(onValueChange).toHaveBeenLastCalledWith('pull');
  expect(screen.getByRole('radio', { name: 'Pull' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Pull' }));
  expect(onValueChange).toHaveBeenLastCalledWith('');
});

test('multiple uses pressed buttons and reports the list of chosen values', () => {
  function Example() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <>
        <ToggleChips
          type="multiple"
          aria-label="Days"
          options={options}
          value={value}
          onValueChange={setValue}
        />
        <output>{value.join(',')}</output>
      </>
    );
  }
  render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: 'Push' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
  expect(screen.getByRole('button', { name: 'Push' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('push,pull')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Push' }));
  expect(screen.getByText('pull')).toBeInTheDocument();
});

test('a disabled chip cannot be chosen and keeps the not-allowed cursor', () => {
  const onValueChange = vi.fn();
  render(<ToggleChips aria-label="Split" options={options} onValueChange={onValueChange} />);
  const legs = screen.getByRole('radio', { name: 'Legs' });
  expect(legs).toBeDisabled();
  expect(legs.className).toContain('disabled:cursor-not-allowed');
  fireEvent.click(legs);
  expect(onValueChange).not.toHaveBeenCalled();
});

test('chips keep the touch height and the pointer cursor, and className reaches the group', () => {
  render(<ToggleChips aria-label="Split" options={options} className="mt-2" />);
  expect(screen.getByRole('radio', { name: 'Push' })).toHaveClass(
    'min-h-10',
    'pointer-coarse:min-h-12',
    'cursor-pointer',
  );
  expect(screen.getByRole('radiogroup', { name: 'Split' })).toHaveClass('mt-2');
});
