import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router';

import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { shiftMonth } from './entry-filters-state';
import { serviceToday } from './format';
import { requestJson } from './lib/api';
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

// Recharts loads in its own file with the first chart; `lazy` keeps a failed load, so a failure starts a new one
// for the next period or retry.
const loadChart = () =>
  lazy(() => import('./trend-chart').then((module) => ({ default: module.TrendChart })));
const chart = { Chart: loadChart() };

/** `version` changes when entries change elsewhere on the page, so the trend reloads. */
export function MonthlyTrend({ version = 0 }: { version?: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = readPeriod(searchParams);
  const to = serviceToday().slice(0, 7);
  const from = shiftMonth(to, -(period - 1));
  const [trend, setTrend] = useState<Trend | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // Bumped by 다시 시도 so a chart that failed to load is tried again.
  const [attempt, setAttempt] = useState(0);
  // Only the latest request may fill the trend.
  const latest = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const data = await requestJson<Trend>(`/api/ledger/trend?from=${from}&to=${to}`);
      if (latest.current === request) setTrend(data);
    } catch {
      if (latest.current === request) setFailed(true);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const choose = (next: number) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === defaultTrendPeriod) params.delete('trend');
      else params.set('trend', String(next));
      return params;
    });

  // As in the monthly summary: another period loading keeps the previous one dimmed; if that load fails, the
  // previous period is not shown under the new one's name.
  const stale = trend !== undefined && (trend.from !== from || trend.to !== to);
  const shown = failed && stale ? undefined : trend;
  const loading = stale && !failed;
  const empty = shown?.months.every((month) => month.income === 0 && month.expense === 0);
  const retry = () => {
    // The retry button goes away at once: focus the section title instead of losing it.
    title.current?.focus();
    setAttempt((count) => count + 1);
    void load();
  };

  return (
    <section aria-labelledby="trend-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trend-title" ref={title} tabIndex={-1} className="outline-none">
          월별 추이
        </h2>
        <div role="group" aria-label="추이 기간" className="flex gap-1">
          {trendPeriods.map((choice) => (
            <Button
              key={choice}
              type="button"
              size="sm"
              variant={choice === period ? 'default' : 'outline'}
              aria-pressed={choice === period}
              onClick={() => choose(choice)}
            >
              {choice}개월
            </Button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="text-body-sm text-muted-foreground">
        {monthLabel(from)} ~ {monthLabel(to)}
      </p>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">추이를 불러오지 못했습니다.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="추이 다시 시도"
            onClick={retry}
          >
            다시 시도
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">추이를 불러오는 중입니다</p>
        )
      ) : (
        <Card aria-busy={loading || undefined} className={cn(loading && 'opacity-60')}>
          <CardHeader>
            <CardTitle asHeading="h3">수입·지출·잔액</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {empty ? (
              <p className="text-body-sm text-muted-foreground">이 기간에는 내역이 없습니다.</p>
            ) : (
              <ChartBoundary key={`${from}:${to}:${attempt}`}>
                <Suspense
                  fallback={
                    <p className="text-body-sm text-muted-foreground">차트를 불러오는 중입니다</p>
                  }
                >
                  <chart.Chart months={shown.months} />
                </Suspense>
              </ChartBoundary>
            )}
            <details>
              <summary className="cursor-pointer text-body-sm font-medium">표로 보기</summary>
              <TrendTable months={shown.months} />
            </details>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/** The chart file failing to load must not take the page down: say so in place of the chart. */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    chart.Chart = loadChart();
  }

  render() {
    return this.state.failed ? (
      <p className="text-body-sm text-muted-foreground">
        차트를 불러오지 못했습니다. 표로 보기에서 값을 확인하세요.
      </p>
    ) : (
      this.props.children
    );
  }
}

const amount = new Intl.NumberFormat('ko-KR');

/**
 * The chart's values as text, newest month first. The unit is in the column headers and a phone gets a smaller
 * size, so four columns fit; if they still do not (very large amounts), the table scrolls inside the card.
 */
function TrendTable({ months }: { months: TrendMonth[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-body-sm whitespace-nowrap tabular-nums max-sm:text-xs">
        <caption className="sr-only">월별 수입·지출·잔액</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 font-medium">
              월
            </th>
            {trendSeries.map((series) => (
              <th key={series.key} scope="col" className="py-2 pl-3 text-right font-medium">
                {series.label}(원)
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
