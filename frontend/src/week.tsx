import { useSearchParams } from 'react-router';

import { DateStepper, RangeSummary } from './components/ui/date-stepper';
import { readDay, shiftDays, weekdayName, weekStart } from './day-nav';
import { serviceToday } from './format';
import type { Health } from './health';
import { Page } from './page';
import { usePeriods } from './period-data';
import { PeriodFailure, PeriodTable } from './period-totals';

// #359 Seven days (Sunday to Saturday) with the totals of each day. `?date=` is any day of the week shown
// (default this week); a day links to the day log.

export function WeekPage({ health }: { health: Health }) {
  const today = serviceToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const anchor = readDay(searchParams, today);
  const first = weekStart(anchor);
  const last = shiftDays(first, 6);
  const { query, rows, failed } = usePeriods(first, 'day', 7);
  const go = (date: string) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (weekStart(date) === weekStart(today)) params.delete('date');
      else params.set('date', date);
      return params;
    });
  const loading = rows !== undefined && rows[0]?.start !== first;
  return (
    <Page title="Week" description="Income and expenses of each day of the week" health={health}>
      <div className="flex flex-col gap-4">
        <DateStepper
          label="Day in the week"
          value={anchor}
          onValueChange={go}
          onMove={(direction) => go(shiftDays(anchor, direction * 7))}
          previousLabel="Previous week"
          nextLabel="Next week"
        />
        <RangeSummary from={first} to={last} />
        {failed ? (
          <PeriodFailure onRetry={() => void query.refetch()} />
        ) : rows ? (
          <PeriodTable
            caption="Income, expense, and balance of each day of the week"
            firstHeading="Day"
            rows={rows}
            rowName={(row) => `${weekdayName(row.start)} ${row.start}`}
            rowLink={(row) => `/?date=${row.start}`}
            loading={loading}
          />
        ) : (
          <p className="text-body-sm text-muted-foreground">Loading totals</p>
        )}
      </div>
    </Page>
  );
}
