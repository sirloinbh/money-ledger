import { addDays, weekStart } from './components/period-nav/periods';
import { serviceToday } from './lib/format';
import { usePeriods } from './period-data';
import { PeriodFailure, PeriodTable } from './period-totals';

// #359 The 12 weeks up to and including this week (Sunday to Saturday), with the income and expense of each.
// A week links to the Week view of the Dashboard (#398).

const weeks = 12;

export function TwelveWeeksView() {
  const first = addDays(weekStart(serviceToday()), -7 * (weeks - 1));
  const { query, rows, failed } = usePeriods(first, 'week', weeks);
  return (
    <>
      {failed ? (
        <PeriodFailure onRetry={() => void query.refetch()} />
      ) : rows ? (
        <PeriodTable
          caption="Income, expense, and balance of each of the last 12 weeks"
          firstHeading="Week"
          rows={rows}
          rowName={(row) => `${row.start} – ${row.end}`}
          rowLink={(row) => `/dashboard?view=week&date=${row.start}`}
          loading={false}
        />
      ) : (
        <p className="text-body-sm text-muted-foreground">Loading totals</p>
      )}
    </>
  );
}
