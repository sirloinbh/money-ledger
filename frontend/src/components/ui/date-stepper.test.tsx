// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { DateStepper, RangeSummary } from './date-stepper';

test('the previous and next buttons move by one step in each direction', () => {
  const onMove = vi.fn();
  render(
    <DateStepper
      label="Reference date"
      value="2026-10-15"
      onValueChange={() => {}}
      onMove={onMove}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
  expect(onMove.mock.calls).toEqual([[-1], [1]]);
  // Buttons inside a form must not submit it.
  expect(screen.getByRole('button', { name: 'Previous period' })).toHaveAttribute('type', 'button');
  expect(screen.getByLabelText('Reference date')).toHaveAttribute('data-slot', 'input');
});

test('a picked date is passed on, a cleared input keeps the current date', () => {
  const onValueChange = vi.fn();
  render(
    <DateStepper
      label="Analysis reference date"
      value="2026-10-15"
      onValueChange={onValueChange}
    />,
  );
  const input = screen.getByLabelText('Analysis reference date');
  fireEvent.change(input, { target: { value: '2026-10-01' } });
  fireEvent.change(input, { target: { value: '' } });
  expect(onValueChange.mock.calls).toEqual([['2026-10-01']]);
  // Without onMove there are no step buttons.
  expect(screen.queryByRole('button', { name: /Previous period|Next period/ })).toBeNull();
});

test('a half-typed date does not move the anchor and the current date returns on blur', () => {
  const onValueChange = vi.fn();
  render(<DateStepper label="Reference date" value="2026-10-15" onValueChange={onValueChange} />);
  const input = screen.getByLabelText('Reference date');
  fireEvent.change(input, { target: { value: '2026-1' } });
  expect(input).toHaveValue('2026-1');
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(input).toHaveValue('2026-10-15');
});

test('the range summary reads the first and last day before its note', () => {
  render(
    <RangeSummary from="2026-10-12" to="2026-10-18">
      Records for the selected period
    </RangeSummary>,
  );
  expect(screen.getByText(/2026-10-12 — 2026-10-18/).textContent).toBe(
    '2026-10-12 — 2026-10-18 Records for the selected period',
  );
});
