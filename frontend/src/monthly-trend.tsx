import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { ChartBoundary } from './chart-boundary';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { shiftMonth } from './entry-filters-state';
import { serviceToday } from './format';
import { lazyChart } from './lazy-chart';
import { ledgerKeys, usePagedRead } from './ledger-query';
import { cn } from './lib/utils';
import {
  defaultTrendPeriod,
  monthLabel,
  type TrendMonth,
  trendPeriods,
  trendSeries,
} from './trend-series';

// #41 Income, expense and balance month by month, ending this month in Seoul, as a line chart with the same
// values in a table. The period (6, 12 or 24 months) is in the address (`?trend=6`, default 12), next to the
// summary month and the entry list filters.

type Trend = { from: string; to: string; months: TrendMonth[] };

/** The period in the address if it is one of the choices, else the default. */
function readPeriod(params: URLSearchParams) {
  const period = Number(params.get('trend'));
  return (trendPeriods as readonly number[]).includes(period) ? period : defaultTrendPeriod;
}

// Recharts loads in its own file with the first chart.
// After a failed download, ChartBoundary (#202) loads the file again on the next try; a drawing error is logged.
const chart = lazyChart(() => import('./trend-chart').then((module) => module.TrendChart));

/** The trend reloads by itself when entries change elsewhere on the page (`ledgerKey`, #213). */
export function MonthlyTrend() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = readPeriod(searchParams);
  const to = serviceToday().slice(0, 7);
  const from = shiftMonth(to, -(period - 1));
  const {
    query,
    data: trend,
    failed,
  } = usePagedRead<Trend>(ledgerKeys.trend(from, to), `/api/ledger/trend?from=${from}&to=${to}`);
  // Bumped by Try again so a chart that failed to load is tried again.
  const [attempt, setAttempt] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);

  const choose = (next: number) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === defaultTrendPeriod) params.delete('trend');
      else params.set('trend', String(next));
      return params;
    });

  // As in the monthly summary: another period loading keeps the previous one dimmed; if that load fails, the
  // previous period is not shown under the new one's name.
  const shown = trend;
  const loading = trend !== undefined && (trend.from !== from || trend.to !== to);
  const empty = shown?.months.every((month) => month.income === 0 && month.expense === 0);
  const retry = () => {
    // The retry button goes away at once: focus the section title instead of losing it.
    title.current?.focus();
    setAttempt((count) => count + 1);
    void query.refetch();
  };

  return (
    <section aria-labelledby="trend-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trend-title" ref={title} tabIndex={-1} className="outline-none">
          Monthly trend
        </h2>
        <div role="group" aria-label="Trend period" className="flex gap-1">
          {trendPeriods.map((choice) => (
            <Button
              key={choice}
              type="button"
              size="sm"
              variant={choice === period ? 'default' : 'outline'}
              aria-pressed={choice === period}
              onClick={() => choose(choice)}
            >
              {choice} months
            </Button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="text-body-sm text-muted-foreground">
        {monthLabel(from)} – {monthLabel(to)}
      </p>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">Could not load the trend.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Retry loading trend"
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">Loading the trend</p>
        )
      ) : (
        <Card aria-busy={loading || undefined} className={cn(loading && 'opacity-60')}>
          <CardHeader>
            <CardTitle asHeading="h3">Income, expense, and balance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {empty ? (
              <p className="text-body-sm text-muted-foreground">
                There are no entries in this period.
              </p>
            ) : (
              <ChartBoundary
                chart={chart}
                message="Could not load the chart. Check the values in the table under View as table."
                key={`${from}:${to}:${attempt}`}
              >
                <chart.Chart months={shown.months} />
              </ChartBoundary>
            )}
            <details>
              <summary className="cursor-pointer text-body-sm font-medium">View as table</summary>
              <TrendTable months={shown.months} />
            </details>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

const amount = new Intl.NumberFormat('en-US');

/**
 * The chart's values as text, newest month first. The unit is in the column headers and a phone gets a smaller
 * size, so four columns fit; if they still do not (very large amounts), the table scrolls inside the card.
 */
function TrendTable({ months }: { months: TrendMonth[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-body-sm whitespace-nowrap tabular-nums max-sm:text-xs">
        <caption className="sr-only">Monthly income, expense, and balance</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 font-medium">
              Month
            </th>
            {trendSeries.map((series) => (
              <th key={series.key} scope="col" className="py-2 pl-3 text-right font-medium">
                {series.label} (KRW)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((month) => (
            <tr key={month.month} className="border-b last:border-b-0">
              <th scope="row" className="py-2 text-left font-normal">
                {monthLabel(month.month)}
              </th>
              {trendSeries.map((series) => (
                <td key={series.key} className="py-2 pl-3 text-right">
                  {amount.format(month[series.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
