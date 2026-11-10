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
import { formatWon, serviceToday } from './format';
import { requestJson } from './lib/api';
import { cn } from './lib/utils';

// #40 One month at a glance: income, expense, balance, and the expense by category as a horizontal bar chart
// with the same values in a table. The month is in the address (`?month=2026-11`, default this month in Seoul),
// next to the entry list filters.

export type CategoryShare = {
  categoryId: number | null;
  name: string;
  hidden: boolean;
  amount: number;
  /** Percent of the month's expense with one decimal, from the server: "35.2". */
  share: string;
};
type Summary = {
  month: string;
  income: number;
  expense: number;
  balance: number;
  categories: CategoryShare[];
};

/** The month in the address if it is one the server accepts, else this month. */
function readMonth(params: URLSearchParams, today: string) {
  const month = params.get('month') ?? '';
  const year = Number(month.slice(0, 4));
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && year >= 1900 && year <= 2100
    ? month
    : today.slice(0, 7);
}

// Recharts is large: the chart loads in its own file when a month with expense is shown, not with the app.
// `lazy` keeps a failed load, so a failure starts a new one for the next month or retry.
const loadChart = () =>
  lazy(() =>
    import('./category-share-chart').then((module) => ({ default: module.CategoryShareChart })),
  );
const chart = { Chart: loadChart() };

/** "2026-11" → "2026년 11월" */
const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;

/** `version` changes when entries change elsewhere on the page, so the totals reload. */
export function MonthlySummary({ version = 0 }: { version?: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = serviceToday();
  const month = readMonth(searchParams, today);
  const [summary, setSummary] = useState<Summary | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // Bumped by 다시 시도 so a chart that failed to load is tried again.
  const [attempt, setAttempt] = useState(0);
  // Only the latest request may fill the summary.
  const latest = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const data = await requestJson<Summary>(`/api/ledger/summary?month=${month}`);
      if (latest.current === request) setSummary(data);
    } catch {
      if (latest.current === request) setFailed(true);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const goMonth = (next: string) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === today.slice(0, 7)) params.delete('month');
      else params.set('month', next);
      return params;
    });

  // While another month loads, the previous one stays dimmed so the buttons and focus hold. If that load
  // fails, the previous month is not shown at all: under the new month's name it would read as its numbers.
  const stale = summary !== undefined && summary.month !== month;
  const shown = failed && stale ? undefined : summary;
  const loading = stale && !failed;
  const retry = () => {
    // The retry button goes away at once: focus the section title instead of losing it.
    title.current?.focus();
    setAttempt((count) => count + 1);
    void load();
  };

  return (
    <section aria-labelledby="summary-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="summary-title" ref={title} tabIndex={-1} className="outline-none">
          월별 요약
        </h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="요약 이전 달"
            onClick={() => goMonth(shiftMonth(month, -1))}
          >
            이전 달
          </Button>
          <p aria-live="polite" className="min-w-24 text-center text-body-sm font-medium">
            {monthLabel(month)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="요약 다음 달"
            onClick={() => goMonth(shiftMonth(month, 1))}
          >
            다음 달
          </Button>
        </div>
      </div>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">요약을 불러오지 못했습니다.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="요약 다시 시도"
            onClick={retry}
          >
            다시 시도
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">요약을 불러오는 중입니다</p>
        )
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn('flex flex-col gap-4', loading && 'opacity-60')}
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Total label="수입" value={formatWon(shown.income)} />
            <Total label="지출" value={formatWon(shown.expense)} />
            <Total label="잔액" value={formatWon(shown.balance)} hint="수입 − 지출" />
          </dl>
          <Card>
            <CardHeader>
              <CardTitle asHeading="h3">카테고리별 지출</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {shown.categories.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">이 달에는 지출이 없습니다.</p>
              ) : (
                <>
                  <ChartBoundary key={`${month}:${attempt}`}>
                    <Suspense
                      fallback={
                        <p className="text-body-sm text-muted-foreground">
                          차트를 불러오는 중입니다
                        </p>
                      }
                    >
                      <chart.Chart categories={shown.categories} />
                    </Suspense>
                  </ChartBoundary>
                  <ShareTable categories={shown.categories} total={shown.expense} />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

/**
 * The chart file failing to load (an old tab after a deploy, offline) must not take the page down: say so in
 * place of the chart. The table next to it still has every value.
 */
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
        차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요.
      </p>
    ) : (
      this.props.children
    );
  }
}

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <dt className="text-body-sm text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 text-caption">({hint})</span> : null}
      </dt>
      <dd className="text-heading-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** The chart's values as text: every category with its amount and share. */
function ShareTable({ categories, total }: { categories: CategoryShare[]; total: number }) {
  return (
    <table className="w-full text-body-sm">
      <caption className="sr-only">카테고리별 지출 금액과 비중</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            카테고리
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            금액
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            비중
          </th>
        </tr>
      </thead>
      <tbody>
        {categories.map((category) => (
          <tr key={category.categoryId ?? 'none'} className="border-b last:border-b-0">
            <th scope="row" className="py-2 text-left font-normal break-words">
              {category.hidden ? `${category.name} (숨김)` : category.name}
            </th>
            <td className="py-2 text-right tabular-nums">{formatWon(category.amount)}</td>
            <td className="py-2 text-right tabular-nums">{category.share}%</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t font-medium">
          <th scope="row" className="py-2 text-left">
            합계
          </th>
          <td className="py-2 text-right tabular-nums">{formatWon(total)}</td>
          <td className="py-2 text-right tabular-nums">{total > 0 ? '100%' : '-'}</td>
        </tr>
      </tfoot>
    </table>
  );
}
