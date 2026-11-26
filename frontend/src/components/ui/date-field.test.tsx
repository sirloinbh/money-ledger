// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { DateField, TimeField } from './date-field';
import {
  addDays,
  addMonths,
  clampDate,
  formatTime,
  isDate,
  longDate,
  monthTitle,
  monthWeeks,
  parseDate,
  parseTime,
  seoulToday,
} from './date-fields';

function Date_({
  initial = '',
  min,
  max,
  required,
  onChange,
}: {
  initial?: string;
  min?: string;
  max?: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="Study date"
      value={value}
      today="2026-11-27"
      min={min}
      max={max}
      required={required}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const field = () => screen.getByRole('textbox', { name: 'Study date' });
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Pick study date from a calendar' }));
const day = (iso: string) => document.querySelector<HTMLButtonElement>(`button[data-day="${iso}"]`)!;

test('date helpers: real dates only, month arithmetic, whole weeks, English names', () => {
  expect(parseDate('2026-02-29')).toBeNull();
  expect(parseDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  expect(isDate('2026-1-5')).toBe(false);
  expect(isDate('0001-01-01')).toBe(true);
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
  expect(clampDate('2026-01-01', '2026-02-01', '2026-03-01')).toBe('2026-02-01');
  expect(monthTitle('2026-11-27')).toBe('November 2026');
  expect(longDate('2026-11-27')).toBe('November 27, 2026');
  const weeks = monthWeeks('2026-11-27');
  expect(weeks[0][0]).toBe('2026-11-01'); // a Sunday
  expect(weeks.every((week) => week.length === 7)).toBe(true);
  expect(weeks.at(-1)!.includes('2026-11-30')).toBe(true);
  expect(monthWeeks('2026-11-27', 1)[0][0]).toBe('2026-10-26'); // Monday first
  expect(seoulToday(new Date('2026-11-26T16:00:00Z'))).toBe('2026-11-27');
  expect(parseTime('09:05')).toEqual({ hour: 9, minute: 5 });
  expect(parseTime('24:00')).toBeNull();
  expect(parseTime('9:05')).toBeNull();
  expect(formatTime(9, 5)).toBe('09:05');
});

test('typing, pasting and clearing pass the text on as it is', () => {
  const onChange = vi.fn();
  render(<Date_ onChange={onChange} />);
  fireEvent.change(field(), { target: { value: '2026-1' } });
  fireEvent.change(field(), { target: { value: '2026-11-27' } });
  fireEvent.change(field(), { target: { value: '' } });
  expect(onChange.mock.calls).toEqual([['2026-1'], ['2026-11-27'], ['']]);
  expect(field()).toHaveAttribute('placeholder', 'YYYY-MM-DD');
});

test('the calendar opens on the value, shows English names and picks a day', () => {
  const onChange = vi.fn();
  render(<Date_ initial="2026-11-05" onChange={onChange} />);
  open();
  const grid = screen.getByRole('grid', { name: 'November 2026' });
  expect(within(grid).getByRole('columnheader', { name: 'Su' })).toHaveAttribute('abbr', 'Sunday');
  expect(day('2026-11-05').closest('td')).toHaveAttribute('aria-selected', 'true');
  expect(day('2026-11-27')).toHaveAttribute('aria-current', 'date');
  expect(day('2026-11-05')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'November 20, 2026' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-11-20');
  expect(field()).toHaveValue('2026-11-20');
  expect(screen.queryByRole('grid')).toBeNull();
});

test('the month buttons and the arrow keys move around', () => {
  render(<Date_ initial="2026-11-30" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByRole('grid', { name: 'December 2026' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  const grid = screen.getByRole('grid', { name: 'November 2026' });
  fireEvent.keyDown(grid, { key: 'ArrowRight' });
  expect(screen.getByRole('grid', { name: 'December 2026' })).toBeInTheDocument();
  expect(day('2026-12-01')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
  expect(day('2026-12-08')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'PageUp' });
  expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'Home' });
  expect(day('2026-11-08')).toHaveFocus(); // the Sunday of that week
});

test('days outside min and max cannot be picked and the keys stop at the limits', () => {
  render(<Date_ initial="2026-11-10" min="2026-11-05" max="2026-11-12" />);
  open();
  expect(day('2026-11-04')).toBeDisabled();
  expect(day('2026-11-13')).toBeDisabled();
  expect(day('2026-11-12')).toBeEnabled();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
  expect(day('2026-11-12')).toHaveFocus();
});

test('Today picks today and Clear empties the field, unless the field is required', () => {
  const { unmount } = render(<Date_ initial="2026-11-05" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(field()).toHaveValue('2026-11-27');
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(field()).toHaveValue('');
  unmount();
  render(<Date_ initial="2026-11-05" required />);
  open();
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
});

test('Escape closes the calendar and the field keeps its value', () => {
  render(<Date_ initial="2026-11-05" />);
  open();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'Escape' });
  expect(screen.queryByRole('grid')).toBeNull();
  expect(field()).toHaveValue('2026-11-05');
});

test('a disabled field cannot open the calendar', () => {
  render(<DateField label="Study date" value="" onValueChange={() => {}} disabled />);
  expect(screen.getByRole('button', { name: 'Pick study date from a calendar' })).toBeDisabled();
});

function Time_({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      label="Start time"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

test('the time field takes typed text and picks the hour then the minute', () => {
  const onChange = vi.fn();
  render(<Time_ onChange={onChange} />);
  const input = screen.getByRole('textbox', { name: 'Start time' });
  expect(input).toHaveAttribute('placeholder', 'HH:MM');
  fireEvent.change(input, { target: { value: '09:3' } });
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick start time from a list' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hour 14' }));
  expect(input).toHaveValue('14:00');
  fireEvent.click(screen.getByRole('button', { name: 'Minute 35' }));
  expect(input).toHaveValue('14:35');
  expect(onChange.mock.calls.map(([v]) => v)).toEqual(['09:3', '', '14:00', '14:35']);
  expect(screen.queryByRole('group', { name: 'Hour' })).toBeNull();
});
