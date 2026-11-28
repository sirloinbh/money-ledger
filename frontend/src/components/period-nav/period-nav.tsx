// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/period-nav/
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { DateStepper } from '../ui/date-stepper';
import {
  addDays,
  defaultWeekStart,
  type PeriodKind,
  periodRange,
  rangeLabel,
  stepDays,
  type WeekStart,
} from './periods';

// Moves a Day, Week or 12-week view: previous, next, a date field and Today, with the shown range below. The page
// owns the date (keep it in `?date=` with readDateParam and writeDateParam) and draws the period itself.
const unit = { day: 'day', week: 'week', '12weeks': '12 weeks' } as const;

function PeriodNav({
  period,
  date,
  today,
  onDateChange,
  weekStartsOn = defaultWeekStart,
  label = 'Reference date',
  children,
  className,
}: {
  period: PeriodKind;
  date: string;
  /** Today's date; the Today button is off while the date is today. */
  today: string;
  onDateChange: (date: string) => void;
  weekStartsOn?: WeekStart;
  label?: string;
  /** A note after the range, for example a total. */
  children?: React.ReactNode;
  className?: string;
}) {
  const { from, to } = periodRange(period, date, weekStartsOn);
  return (
    <div data-slot="period-nav" className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <DateStepper
          label={label}
          value={date}
          onValueChange={onDateChange}
          onMove={(direction) => onDateChange(addDays(date, direction * stepDays(period)))}
          previousLabel={`Previous ${unit[period]}`}
          nextLabel={`Next ${unit[period]}`}
        />
        <Button
          type="button"
          variant="outline"
          disabled={date === today}
          onClick={() => onDateChange(today)}
        >
          Today
        </Button>
      </div>
      <p data-slot="period-range" className="mt-4 mb-5 text-xs text-foreground">
        {rangeLabel(from, to)}
        {children && <span className="ml-2.5 text-muted-foreground">{children}</span>}
      </p>
    </div>
  );
}

export { PeriodNav };
