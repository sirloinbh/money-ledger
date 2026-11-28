// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/period-nav/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { PeriodNav } from './period-nav';

test('previous and next move by the size of the period', () => {
  const onDateChange = vi.fn();
  const { rerender } = render(
    <PeriodNav period="day" date="2026-11-27" today="2026-11-27" onDateChange={onDateChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
  rerender(
    <PeriodNav period="week" date="2026-11-27" today="2026-11-27" onDateChange={onDateChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  rerender(
    <PeriodNav period="12weeks" date="2026-11-27" today="2026-11-27" onDateChange={onDateChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next 12 weeks' }));
  expect(onDateChange.mock.calls).toEqual([
    ['2026-11-26'],
    ['2026-11-28'],
    ['2026-11-20'],
    ['2027-02-19'],
  ]);
});

test('Today returns to today and is off while the date is today', () => {
  const onDateChange = vi.fn();
  const { rerender } = render(
    <PeriodNav period="week" date="2026-11-27" today="2026-11-27" onDateChange={onDateChange} />,
  );
  expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  rerender(
    <PeriodNav period="week" date="2026-10-01" today="2026-11-27" onDateChange={onDateChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(onDateChange).toHaveBeenCalledWith('2026-11-27');
});

test('the shown range follows the period and the week start', () => {
  const { rerender } = render(
    <PeriodNav period="day" date="2026-11-27" today="2026-11-27" onDateChange={() => {}} />,
  );
  expect(screen.getByText('Fri, Nov 27, 2026')).toBeInTheDocument();
  rerender(
    <PeriodNav period="week" date="2026-11-27" today="2026-11-27" onDateChange={() => {}} />,
  );
  expect(screen.getByText('Nov 22 – Nov 28')).toBeInTheDocument();
  rerender(
    <PeriodNav
      period="week"
      date="2026-11-27"
      today="2026-11-27"
      weekStartsOn={1}
      onDateChange={() => {}}
    >
      3 entries
    </PeriodNav>,
  );
  expect(screen.getByText('Nov 23 – Nov 29')).toBeInTheDocument();
  expect(screen.getByText('3 entries')).toBeInTheDocument();
});

test('a typed date is passed on', () => {
  const onDateChange = vi.fn();
  render(
    <PeriodNav period="day" date="2026-11-27" today="2026-11-27" onDateChange={onDateChange} />,
  );
  fireEvent.change(screen.getByLabelText('Reference date'), { target: { value: '2026-10-05' } });
  expect(onDateChange).toHaveBeenCalledWith('2026-10-05');
});
