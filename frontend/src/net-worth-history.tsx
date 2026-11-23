import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ChartBoundary } from './chart-boundary';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { countOf, formatWon, serviceToday } from './format';
import { lazyChart } from './lazy-chart';
import { type RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { cn } from './lib/utils';
import {
  dayLabel,
  netWorthPath,
  type Period,
  periods,
  periodStart,
  saveTodayOnce,
  type Snapshot,
} from './net-worth';
import { portfolioKeys } from './portfolio-query';
import { refreshReads } from './query-reads';

// #49 "Net worth trend" under the asset allocation card (decisions 2026-11-10). The saved days of a period as a line
// and a table; days without a save are not filled in. "Save current values" saves today's totals again.

// Recharts is large: the chart loads in its own file when there is something to draw, not with the app.
// After a failed download, ChartBoundary (#202) loads the file again on the next try; a drawing error is logged.
const chart = lazyChart(() => import('./net-worth-chart').then((module) => module.NetWorthChart));

type List = { today: string; snapshots: Snapshot[] };

export function NetWorthHistory() {
  const [period, setPeriod] = useState<Period>('3m');
  const [saving, setSaving] = useState(false);
  // Bumped by Try again and by a save, so a chart that failed to load is loaded again.
  const [attempt, setAttempt] = useState(0);
  const client = useQueryClient();
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  const today = serviceToday();
  const from = periodStart(today, period);

  // #278 The list of another period stays (dimmed) while the chosen one loads; once that load fails there is no
  // list, so the old period's records are not shown under the new period's dates.
  const query = useQuery<List, RequestError>({
    queryKey: portfolioKeys.netWorth(from ?? undefined),
    // Today's save from opening the app goes first, so today is in the list.
    queryFn: ({ signal }) =>
      saveTodayOnce().then(() =>
        requestJson<List>(from ? `${netWorthPath}?from=${from}` : netWorthPath, { signal }),
      ),
    placeholderData: keepPreviousData,
  });
  const failed = query.isError && !query.isFetching;

  const saveNow = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { snapshot } = await requestJson<{ snapshot: Snapshot }>(netWorthPath, {
        method: 'POST',
      });
      showStatus(
        `Saved the net worth of ${formatWon(snapshot.netKrw)} for ${dayLabel(snapshot.date)}`,
      );
      setAttempt((value) => value + 1);
      await refreshReads(client, portfolioKeys.netWorthAll());
    } catch (cause) {
      showError(cause, 'Could not save the net worth');
    } finally {
      setSaving(false);
    }
  };

  // The list of another period stays (dimmed) while the chosen one loads; once that load fails it is hidden, so
  // the old period's records are not shown under the new period's dates.
  const shown = query.data;
  const loading = query.isPlaceholderData;
  // The axis starts at the period's first day, or at the first save for the whole history.
  const axisFrom = from ?? shown?.snapshots[0]?.date ?? today;

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">Net worth trend</CardTitle>
        <CardDescription>
          On each day you open the app, its net worth (total assets − total liabilities) is saved
          once. Saving again the same day replaces that day. Days without a save join the days on
          either side.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Net worth period" className="flex gap-1">
            {periods.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={item.id === period ? 'default' : 'outline'}
                aria-pressed={item.id === period}
                onClick={() => setPeriod(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void saveNow()}
          >
            {saving ? 'Saving…' : 'Save current values'}
          </Button>
        </div>
        <Notice notice={notice.notice} />
        <p aria-live="polite" className="text-body-sm text-muted-foreground">
          {from ? `${dayLabel(from)} – ${dayLabel(today)}` : `All records – ${dayLabel(today)}`}
        </p>
        {failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body-sm text-muted-foreground">
              Could not load the net worth records.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Try loading the net worth records again"
              onClick={() => {
                setAttempt((value) => value + 1);
                void query.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {shown === undefined ? (
          failed ? null : (
            <p className="text-body-sm text-muted-foreground">Loading the net worth records</p>
          )
        ) : (
          <div
            aria-busy={loading || undefined}
            className={cn('flex flex-col gap-4', loading && 'opacity-60')}
          >
            {shown.snapshots.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">No records in this period.</p>
            ) : (
              <>
                <ChartBoundary
                  chart={chart}
                  message="Could not load the chart. Check the values in the table below."
                  key={`${period}:${attempt}`}
                >
                  <chart.Chart snapshots={shown.snapshots} from={axisFrom} to={today} />
                </ChartBoundary>
                <details>
                  <summary className="cursor-pointer text-body-sm font-medium">
                    Show as a table ({countOf(shown.snapshots.length, 'day')})
                  </summary>
                  <SnapshotTable snapshots={shown.snapshots} />
                </details>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Every saved day, newest first. The unit is in the column headings so four columns fit on a phone. */
function SnapshotTable({ snapshots }: { snapshots: Snapshot[] }) {
  return (
    <table className="mt-2 w-full text-body-sm">
      <caption className="sr-only">Net worth, assets, and liabilities by date</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            Date
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Net worth (₩)
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Assets (₩)
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Liabilities (₩)
          </th>
        </tr>
      </thead>
      <tbody>
        {[...snapshots].reverse().map((snapshot) => (
          <tr key={snapshot.date} className="border-b last:border-b-0">
            <th scope="row" className="py-2 pr-2 text-left font-normal whitespace-nowrap">
              {dayLabel(snapshot.date)}
              {snapshot.uncounted > 0 ? (
                <span className="block text-caption text-muted-foreground">
                  {countOf(snapshot.uncounted, 'item')} left out
                </span>
              ) : null}
            </th>
            <td className="py-2 text-right tabular-nums">{number(snapshot.netKrw)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{number(snapshot.assetsKrw)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{number(snapshot.debtsKrw)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
