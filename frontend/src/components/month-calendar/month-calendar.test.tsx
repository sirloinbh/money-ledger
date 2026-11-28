// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/month-calendar/
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Heatmap } from './heatmap';
import { bandLabels, bandLevel } from './heatmap-bands';
import { MonthCalendar } from './month-calendar';

test('the calendar is a named month grid with weekday headers starting on Sunday', () => {
  render(<MonthCalendar month="2026-11-15" onMonthChange={() => {}} today="2026-11-27" />);
  const table = screen.getByRole('table', { name: 'November 2026' });
  const heads = within(table).getAllByRole('columnheader');
  expect(heads.map((h) => h.textContent)).toEqual([
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
  ]);
  expect(heads[0]).toHaveAttribute('abbr', 'Sunday');
});

test('the week can start on Monday, and days of other months are blank cells', () => {
  render(
    <MonthCalendar
      month="2026-11-15"
      onMonthChange={() => {}}
      weekStartsOn={1}
      onSelect={() => {}}
    />,
  );
  expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Mon');
  // 30 days in November, no button for October or December days.
  expect(
    screen
      .getAllByRole('button')
      .filter((b) => /^November/.test(b.getAttribute('aria-label') ?? '')),
  ).toHaveLength(30);
  expect(screen.queryByRole('button', { name: 'October 31, 2026' })).toBeNull();
});

test('the previous and next buttons ask for the neighbouring months', () => {
  const onMonthChange = vi.fn();
  render(<MonthCalendar month="2026-01-31" onMonthChange={onMonthChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(onMonthChange.mock.calls[0]?.[0]).toMatch(/^2025-12/);
  expect(onMonthChange.mock.calls[1]?.[0]).toMatch(/^2026-02/);
});

test('minDate and maxDate stop the month buttons and disable the days outside them', () => {
  render(
    <MonthCalendar
      month="2026-11-15"
      onMonthChange={() => {}}
      onSelect={() => {}}
      minDate="2026-11-10"
      maxDate="2026-11-20"
    />,
  );
  expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'November 9, 2026' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'November 10, 2026' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'November 21, 2026' })).toBeDisabled();
});

test('choosing a day calls onSelect and the selected day is aria-pressed', () => {
  const onSelect = vi.fn();
  render(
    <MonthCalendar
      month="2026-11-15"
      onMonthChange={() => {}}
      selected="2026-11-12"
      onSelect={onSelect}
      today="2026-11-27"
    />,
  );
  expect(screen.getByRole('button', { name: 'November 12, 2026' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'November 13, 2026' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(screen.getByRole('button', { name: 'November 27, 2026' })).toHaveAttribute(
    'aria-current',
    'date',
  );
  fireEvent.click(screen.getByRole('button', { name: 'November 13, 2026' }));
  expect(onSelect).toHaveBeenCalledWith('2026-11-13');
});

test('renderDay puts content under each day, and a month without data still renders', () => {
  const { rerender } = render(
    <MonthCalendar
      month="2026-11-15"
      onMonthChange={() => {}}
      onSelect={() => {}}
      renderDay={(day) => (day === '2026-11-12' ? <span>3 entries</span> : null)}
    />,
  );
  expect(
    within(screen.getByRole('button', { name: 'November 12, 2026' })).getByText('3 entries'),
  ).toBeInTheDocument();
  rerender(<MonthCalendar month="2026-02-01" onMonthChange={() => {}} onSelect={() => {}} />);
  expect(screen.getAllByRole('button', { name: /^February/ })).toHaveLength(28);
});

test('without onSelect the days are labelled groups, not buttons', () => {
  render(<MonthCalendar month="2026-11-15" onMonthChange={() => {}} />);
  expect(screen.queryByRole('button', { name: 'November 12, 2026' })).toBeNull();
  expect(screen.getByRole('group', { name: 'November 12, 2026' })).toBeInTheDocument();
});

test('band levels count the thresholds a value reaches, and the legend words match', () => {
  expect(bandLevel(undefined, [1, 3, 6])).toBe(0);
  expect(bandLevel(0, [1, 3, 6])).toBe(0);
  expect(bandLevel(1, [1, 3, 6])).toBe(1);
  expect(bandLevel(5, [1, 3, 6])).toBe(2);
  expect(bandLevel(6, [1, 3, 6])).toBe(3);
  expect(bandLevel(Number.NaN, [1, 3, 6])).toBe(0);
  expect(bandLabels([1, 3, 6])).toEqual(['0', '1–2', '3–5', '6+']);
  expect(bandLabels([1, 2, 3])).toEqual(['0', '1', '2', '3+']);
  expect(bandLabels([5])).toEqual(['0–4', '5+']);
  expect(bandLabels([])).toEqual(['0']);
});

test('the heatmap labels every day in range with its value, and shades by band', () => {
  const { container } = render(
    <Heatmap
      label="Workouts per day"
      unit="workouts"
      values={{ '2026-11-10': 1, '2026-11-11': 4, '2026-11-12': 9 }}
      bands={[1, 3, 6]}
      from="2026-11-08"
      to="2026-11-14"
    />,
  );
  expect(screen.getByRole('region', { name: 'Workouts per day' })).toHaveAttribute('tabindex', '0');
  expect(screen.getAllByRole('img')).toHaveLength(7);
  expect(screen.getByRole('img', { name: 'November 10, 2026: 1 workouts' })).toHaveAttribute(
    'data-level',
    '1',
  );
  expect(screen.getByRole('img', { name: 'November 11, 2026: 4 workouts' })).toHaveAttribute(
    'data-level',
    '2',
  );
  expect(screen.getByRole('img', { name: 'November 12, 2026: 9 workouts' })).toHaveAttribute(
    'data-level',
    '3',
  );
  expect(screen.getByRole('img', { name: 'November 8, 2026: 0 workouts' })).toHaveAttribute(
    'data-level',
    '0',
  );
  // The legend says what each shade means, so color is not the only signal.
  const legend = container.querySelector('[data-slot="heatmap-legend"]');
  expect(legend?.textContent).toContain('0 workouts');
  expect(legend?.textContent).toContain('1–2 workouts');
  expect(legend?.textContent).toContain('6+ workouts');
});

test('days outside from and to are not drawn as data', () => {
  render(<Heatmap label="Activity" values={{}} bands={[1]} from="2026-11-11" to="2026-11-13" />);
  expect(screen.getAllByRole('img')).toHaveLength(3);
  expect(screen.queryByRole('img', { name: /November 10/ })).toBeNull();
});
