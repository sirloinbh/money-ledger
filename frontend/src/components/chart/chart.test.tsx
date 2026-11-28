// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/chart/
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { BarChart, ChartBoundary, LineChart } from './chart';
import { formatValue, niceMax, share } from './chart-data';

const data = [
  { label: 'Mon', value: 30 },
  { label: 'Tue', value: 45 },
  { label: 'Wed', value: 0 },
];

test('niceMax rounds up to a round axis top and never returns 0', () => {
  expect(niceMax([])).toBe(1);
  expect(niceMax([0, 0])).toBe(1);
  expect(niceMax([45])).toBe(50);
  expect(niceMax([1200])).toBe(2000);
  expect(niceMax([2.3])).toBe(2.5);
  expect(niceMax([10])).toBe(10);
  expect(niceMax([Number.NaN, 3])).toBe(5);
});

test('share keeps a value inside the axis and ignores bad numbers', () => {
  expect(share(25, 50)).toBe(0.5);
  expect(share(80, 50)).toBe(1);
  expect(share(-5, 50)).toBe(0);
  expect(share(Number.NaN, 50)).toBe(0);
  expect(formatValue(1200.456)).toBe('1,200.46');
});

test('a bar chart is a captioned figure whose values are also a table', () => {
  render(<BarChart title="Minutes per day" valueLabel="Minutes" data={data} />);
  const figure = screen.getByRole('figure', { name: 'Minutes per day' });
  const table = within(figure).getByRole('table', { name: 'Minutes per day' });
  expect(within(table).getByRole('columnheader', { name: 'Minutes' })).toBeInTheDocument();
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  expect(within(table).getByRole('cell', { name: '45' })).toBeInTheDocument();
  // The drawn part is hidden from screen readers, so values are not read twice.
  expect(figure.querySelector('[aria-hidden="true"]')).not.toBeNull();
});

test('bars are scaled to the round axis top, using theme colors', () => {
  const { container } = render(<BarChart title="Minutes" data={data} />);
  const bars = container.querySelectorAll<HTMLElement>('.bg-primary');
  expect(bars).toHaveLength(3);
  // 45 of 50 fills 90% of the 85% plot height, 0 fills nothing.
  expect(bars[1]?.style.height).toBe('76.5%');
  expect(bars[2]?.style.height).toBe('0%');
});

test('a line chart marks every point and labels the first and last', () => {
  const { container } = render(<LineChart title="Weight" data={data} />);
  expect(container.querySelectorAll('[title]')).toHaveLength(3);
  expect(container.querySelector('path')).toHaveAttribute('d', 'M0,40 L50,10 L100,100');
  expect(screen.getAllByText('Mon').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Wed').length).toBeGreaterThan(0);
});

test('an empty chart says so instead of drawing', () => {
  render(<LineChart title="Weight" data={[]} />);
  expect(screen.getByText('No data to show.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('no chart text is smaller than the 12px type scale', () => {
  const { container } = render(<BarChart title="Minutes" data={data} />);
  expect(container.innerHTML).not.toMatch(/text-\[\d+px\]|font-size/);
});

function Broken(): never {
  throw new Error('chart module failed');
}

test('a chart that throws shows a message, the table and a retry', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let fail = true;
  function Maybe() {
    if (fail) return <Broken />;
    return <p>Chart is back</p>;
  }
  render(
    <ChartBoundary title="Minutes per day" data={data}>
      <Maybe />
    </ChartBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The chart could not be drawn.');
  expect(screen.getByRole('table', { name: 'Minutes per day' })).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Chart is back')).toBeInTheDocument();
  spy.mockRestore();
});

test('without data the boundary shows only the message and the retry', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ChartBoundary>
      <Broken />
    </ChartBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The chart could not be drawn.');
  expect(screen.queryByRole('table')).toBeNull();
  spy.mockRestore();
});
