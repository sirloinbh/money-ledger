import { useState } from 'react';

import { ChartBoundary } from './chart-boundary';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { formatWon, signedPercent } from './format';
import { lazyChart } from './lazy-chart';
import { serviceToday } from './lib/format';
import { useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { mockKeys } from './mock-query';
import type { ReturnPoint } from './mock-return-chart';
import { useLoadError } from './query-reads';

// #54 How the mock account's return moved by day (decisions 2026-11-10): the chart starts at 0% on the day the
// account started and joins the saved daily values; days before snapshots existed are not filled in. The
// period is the last 1 or 3 months, or everything.

type Snapshots = {
  startDate: string;
  initialCashKrw: number;
  snapshots: ReturnPoint[];
};
type Period = '1m' | '3m' | 'all';

const periods: { value: Period; label: string; months: number | null }[] = [
  { value: '1m', label: '1 month', months: 1 },
  { value: '3m', label: '3 months', months: 3 },
  { value: 'all', label: 'All', months: null },
];

// Recharts is large: the chart loads in its own file, as in #40.
// After a failed download, ChartBoundary (#202) loads the file again on the next try; a drawing error is logged.
const chart = lazyChart(() =>
  import('./mock-return-chart').then((module) => module.MockReturnChart),
);

/** "2026-11-10" minus `months` months, as YYYY-MM-DD (the day is clamped, so 3-31 minus 1 is 2-28). */
function monthsBefore(date: string, months: number) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 - months;
  const target = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(Number(date.slice(8, 10)), lastDay));
  return target.toISOString().slice(0, 10);
}

/** The start (0% on the account's first day) and every saved day, oldest first. */
function allPoints(data: Snapshots): ReturnPoint[] {
  const start: ReturnPoint = {
    date: data.startDate,
    totalKrw: data.initialCashKrw,
    profitKrw: 0,
    returnPct: '0.00',
  };
  return data.snapshots[0]?.date === data.startDate ? data.snapshots : [start, ...data.snapshots];
}

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);

/** Reloads with every mock change (`mockKey`, #213): an order saves the day's value. */
export function MockReturns({ accountId }: { accountId: number }) {
  const read = useApiQuery<Snapshots>(
    mockKeys.snapshots(accountId),
    `/api/mock/accounts/${accountId}/snapshots`,
  );
  const [period, setPeriod] = useState<Period>('1m');
  // Bumped by Try again so a chart that failed to load is tried again.
  const [attempt, setAttempt] = useState(0);
  const notice = useNotice();
  const { error: showError, clear } = notice;
  useLoadError(read.error, showError, 'Could not load the return trend');
  // A load that succeeds clears the message of one that failed before.
  const [seen, setSeen] = useState(read.data);
  if (read.data !== seen) {
    setSeen(read.data);
    if (read.data) clear();
  }

  const loaded = read.data;
  const months = periods.find((item) => item.value === period)?.months ?? null;
  const from = months === null ? '' : monthsBefore(serviceToday(), months);
  const points = loaded ? allPoints(loaded).filter((point) => point.date >= from) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">Return trend</CardTitle>
        <CardDescription>
          Return against the starting amount. It starts at 0% on the day the account began, and one
          value per day is saved when quotes are received and when you place an order.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="group" aria-label="Period" className="flex gap-2">
          {periods.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={period === item.value ? 'default' : 'outline'}
              aria-pressed={period === item.value}
              onClick={() => setPeriod(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <Notice id="mock-returns-notice" notice={notice.notice} />
        {!loaded ? (
          notice.notice?.kind === 'error' ? null : (
            <p role="status" className="text-body-sm text-muted-foreground">
              Loading the return trend
            </p>
          )
        ) : points.length < 2 ? (
          <p className="text-body-sm text-muted-foreground">
            {points.length === 0
              ? 'No values are saved for this period.'
              : 'Only one value so far. Receive a day of quotes or place an order to save the value for that day.'}
          </p>
        ) : (
          <>
            <ChartBoundary
              chart={chart}
              message="Could not load the chart. Check the values in the table below."
              key={`${period}:${attempt}`}
              onRetry={() => setAttempt((n) => n + 1)}
            >
              <chart.Chart points={points} />
            </ChartBoundary>
            <details className="rounded-xl border px-4 py-3">
              <summary className="cursor-pointer text-body-sm font-medium">View as table</summary>
              <table className="mt-2 w-full text-body-sm">
                <caption className="sr-only">Total assets, gain/loss, and return by date</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 font-medium">
                      Date
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Total assets
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Gain/loss
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Return
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((point) => (
                    <tr key={point.date} className="border-b last:border-b-0">
                      <th
                        scope="row"
                        className="py-2 text-left font-normal whitespace-nowrap tabular-nums"
                      >
                        {point.date}
                      </th>
                      <td className="py-2 text-right tabular-nums">{formatWon(point.totalKrw)}</td>
                      <td className="py-2 text-right tabular-nums">{signedWon(point.profitKrw)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {signedPercent(point.returnPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
