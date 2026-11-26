import { useSearchParams } from 'react-router';

import { Button } from './components/ui/button';
import { DateStepper } from './components/ui/date-stepper';
import { dayLabel, readDay, shiftDays } from './day-nav';
import { EntryManager } from './entries';
import { formatWon, serviceToday } from './format';
import type { Health } from './health';
import { Page } from './page';
import { usePeriods } from './period-data';
import { PeriodFailure } from './period-totals';

// #359 The start page: one day's entries with the add button, and a stepper to the day before and after.
// The day is `?date=YYYY-MM-DD` in the address (default today in Seoul).

export function DayLogPage({ health }: { health: Health }) {
  const today = serviceToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const day = readDay(searchParams, today);
  const { query, rows, failed } = usePeriods(day, 'day', 1);
  const totals = rows?.[0];
  const go = (date: string) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('page');
      if (date === today) params.delete('date');
      else params.set('date', date);
      return params;
    });
  return (
    <Page title="Day log" description={`Entries of ${dayLabel(day)}`} health={health}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <DateStepper
            label="Day"
            value={day}
            onValueChange={go}
            onMove={(direction) => go(shiftDays(day, direction))}
            previousLabel="Previous day"
            nextLabel="Next day"
          />
          {day !== today ? (
            <Button type="button" variant="outline" size="sm" onClick={() => go(today)}>
              Today
            </Button>
          ) : null}
        </div>
        {failed ? (
          <PeriodFailure onRetry={() => void query.refetch()} />
        ) : (
          <p className="text-body-sm tabular-nums" aria-live="polite">
            {totals
              ? `Income ${formatWon(totals.income)} · Expense ${formatWon(totals.expense)} · Balance ${formatWon(totals.balance)}`
              : 'Loading totals'}
          </p>
        )}
        <EntryManager day={day} />
      </div>
    </Page>
  );
}
