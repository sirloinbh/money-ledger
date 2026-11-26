import { shiftDays, weekStart } from './day-nav';
import { serviceToday } from './format';
import type { Health } from './health';
import { Page } from './page';
import { usePeriods } from './period-data';
import { PeriodFailure, PeriodTable } from './period-totals';

// #359 The 12 weeks up to and including this week (Sunday to Saturday), with the income and expense of each.
// A week links to the Week page.

const weeks = 12;

export function TwelveWeeksPage({ health }: { health: Health }) {
  const first = shiftDays(weekStart(serviceToday()), -7 * (weeks - 1));
  const { query, rows, failed } = usePeriods(first, 'week', weeks);
  return (
    <Page
      title="12 weeks"
      description="Weekly income and expenses of the last 12 weeks"
      health={health}
    >
      {failed ? (
        <PeriodFailure onRetry={() => void query.refetch()} />
      ) : rows ? (
        <PeriodTable
          caption="Income, expense, and balance of each of the last 12 weeks"
          firstHeading="Week"
          rows={rows}
          rowName={(row) => `${row.start} – ${row.end}`}
          rowLink={(row) => `/week?date=${row.start}`}
          loading={false}
        />
      ) : (
        <p className="text-body-sm text-muted-foreground">Loading totals</p>
      )}
    </Page>
  );
}
