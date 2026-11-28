import { useSearchParams } from 'react-router';

import { addDays, weekStart } from './components/period-nav/periods';
import { DateStepper, RangeSummary } from './components/ui/date-stepper';
import { readDay, weekdayName } from './day-nav';
import { serviceToday } from './lib/format';
import { usePeriods } from './period-data';
import { PeriodFailure, PeriodTable } from './period-totals';

// #359 Seven days (Sunday to Saturday) with the totals of each day. `?date=` is any day of the week shown
// (default this week); a day links to the day log. A view of the Dashboard since #398.

export function WeekView() {
  const today = serviceToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const anchor = readDay(searchParams, today);
  const first = weekStart(anchor);
  const last = addDays(first, 6);
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
    <>
      <div className="flex flex-col gap-4">
        <DateStepper
          label="Day in the week"
          value={anchor}
          onValueChange={go}
          onMove={(direction) => go(addDays(anchor, direction * 7))}
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
    </>
  );
}
