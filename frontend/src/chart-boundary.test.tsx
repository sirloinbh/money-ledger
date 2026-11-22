import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { ChartBoundary } from './chart-boundary';
import { lazyChart } from './lazy-chart';

// #202 The one boundary for lazy charts: a failed download is loaded again, a drawing error is logged.

afterEach(() => vi.restoreAllMocks());

function Screen({ chart }: { chart: ReturnType<typeof lazyChart<{ label: string }>> }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ChartBoundary
      key={attempt}
      chart={chart}
      message="Could not load the chart. Check the values in the table below."
      onRetry={() => setAttempt((n) => n + 1)}
    >
      <chart.Chart label="Chart" />
    </ChartBoundary>
  );
}

test('a chart file that fails to load is warned about and loaded again on Try again', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let loads = 0;
  const chart = lazyChart<{ label: string }>(() => {
    loads += 1;
    return loads === 1
      ? Promise.reject(new Error('Failed to fetch dynamically imported module'))
      : Promise.resolve(({ label }: { label: string }) => <p>{label}</p>);
  });
  render(<Screen chart={chart} />);
  expect(
    await screen.findByText('Could not load the chart. Check the values in the table below.'),
  ).toBeInTheDocument();
  expect(warn).toHaveBeenCalledWith('[chart] the chart file did not load', expect.any(Error));
  expect(error.mock.calls.some((call) => String(call[0]).startsWith('[chart]'))).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Chart')).toBeInTheDocument();
  expect(loads).toBe(2);
});

test('a chart that fails while drawing is logged as an error and its file is not downloaded again', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let loads = 0;
  let broken = true;
  const chart = lazyChart<{ label: string }>(() => {
    loads += 1;
    return Promise.resolve(({ label }: { label: string }) => {
      if (broken) throw new Error('bad data');
      return <p>{label}</p>;
    });
  });
  render(<Screen chart={chart} />);
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(error).toHaveBeenCalledWith(
    '[chart] the chart failed to draw',
    expect.objectContaining({ message: 'bad data' }),
    expect.any(String),
  );

  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Chart')).toBeInTheDocument();
  expect(loads).toBe(1);
});

test('without onRetry there is only the message', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const chart = lazyChart<{ label: string }>(() => Promise.reject(new Error('offline')));
  render(
    <ChartBoundary chart={chart} message="Could not load the chart.">
      <chart.Chart label="Chart" />
    </ChartBoundary>,
  );
  expect(await screen.findByText('Could not load the chart.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});
