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
import { readSummaryMonth } from './summary-month';
import { monthLabel } from './trend-series';

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

// Recharts is large: the chart loads in its own file when a month with expense is shown, not with the app.
// `lazy` keeps a failed load, so a failure starts a new one for the next month or retry.
const loadChart = () =>
  lazy(() =>
    import('./category-share-chart').then((module) => ({ default: module.CategoryShareChart })),
  );
const chart = { Chart: loadChart() };

/** `version` changes when entries change elsewhere on the page, so the totals reload. */
export function MonthlySummary({ version = 0 }: { version?: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = serviceToday();
  const month = readSummaryMonth(searchParams, today);
  const [summary, setSummary] = useState<Summary | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // Bumped by Try again so a chart that failed to load is tried again.
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
          Monthly summary
        </h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Summary previous month"
            onClick={() => goMonth(shiftMonth(month, -1))}
          >
            Previous month
          </Button>
          <p aria-live="polite" className="min-w-24 text-center text-body-sm font-medium">
            {monthLabel(month)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Summary next month"
            onClick={() => goMonth(shiftMonth(month, 1))}
          >
            Next month
          </Button>
        </div>
      </div>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">Could not load the summary.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Retry loading summary"
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">Loading the summary</p>
        )
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn('flex flex-col gap-4', loading && 'opacity-60')}
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Total label="Income" value={formatWon(shown.income)} />
            <Total label="Expense" value={formatWon(shown.expense)} />
            <Total label="Balance" value={formatWon(shown.balance)} hint="Income − expense" />
          </dl>
          <Card>
            <CardHeader>
              <CardTitle asHeading="h3">Expense by category</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {shown.categories.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  There is no expense this month.
                </p>
              ) : (
                <>
                  <ChartBoundary key={`${month}:${attempt}`}>
                    <Suspense
                      fallback={
                        <p className="text-body-sm text-muted-foreground">Loading the chart</p>
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
        Could not load the chart. Check the values in the table below.
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
      <caption className="sr-only">Expense amounts and shares by category</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            Category
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Amount
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {categories.map((category) => (
          <tr key={category.categoryId ?? 'none'} className="border-b last:border-b-0">
            <th scope="row" className="py-2 text-left font-normal break-words">
              {category.hidden ? `${category.name} (hidden)` : category.name}
            </th>
            <td className="py-2 text-right tabular-nums">{formatWon(category.amount)}</td>
            <td className="py-2 text-right tabular-nums">{category.share}%</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t font-medium">
          <th scope="row" className="py-2 text-left">
            Total
          </th>
          <td className="py-2 text-right tabular-nums">{formatWon(total)}</td>
          <td className="py-2 text-right tabular-nums">{total > 0 ? '100%' : '-'}</td>
        </tr>
      </tfoot>
    </table>
  );
}
