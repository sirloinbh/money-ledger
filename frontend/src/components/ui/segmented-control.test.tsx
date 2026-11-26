// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { SegmentedControl } from './segmented-control';

const options = [
  { value: 'week', label: '1 week' },
  { value: 'month', label: '1 month' },
  { value: 'year', label: '1 year' },
] as const;

function Period({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<(typeof options)[number]['value']>('week');
  return (
    <SegmentedControl
      label="Period"
      options={options}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

test('the group is named and only the current option is checked', () => {
  render(<Period />);
  expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '1 week' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '1 month' })).not.toBeChecked();
});

test('choosing another option moves the selection', () => {
  const onChange = vi.fn();
  render(<Period onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: '1 month' }));
  expect(onChange).toHaveBeenCalledWith('month');
  expect(screen.getByRole('radio', { name: '1 month' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '1 week' })).not.toBeChecked();
});

test('clicking the current option keeps it selected', () => {
  const onChange = vi.fn();
  render(<Period onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: '1 week' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: '1 week' })).toBeChecked();
});

test('clicking the current option reports a reselect', () => {
  const onReselect = vi.fn();
  render(
    <SegmentedControl
      label="Period"
      options={options}
      value="week"
      onValueChange={() => {}}
      onReselect={onReselect}
    />,
  );
  fireEvent.click(screen.getByRole('radio', { name: '1 week' }));
  expect(onReselect).toHaveBeenCalledOnce();
});

test('focus enters on the selected option and arrow keys move it', async () => {
  render(<Period />);
  screen.getByRole('radiogroup', { name: 'Period' }).focus();
  const current = screen.getByRole('radio', { name: '1 week' });
  await waitFor(() => expect(current).toHaveFocus());
  fireEvent.keyDown(current, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('radio', { name: '1 month' })).toHaveFocus());
});

test('touch screens get 44px tall segments (#1103)', () => {
  render(<Period />);
  for (const name of ['1 week', '1 month', '1 year']) {
    expect(screen.getByRole('radio', { name })).toHaveClass('pointer-coarse:min-h-11');
  }
});
