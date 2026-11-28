// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/month-calendar/
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import {
  addMonths,
  isDate,
  longDate,
  monthNames,
  monthTitle,
  monthWeeks,
  seoulToday,
  weekdayNames,
} from '../ui/date-fields';

// A month grid with room for content in each day (#18). It shows one month; the page owns the month (`month`) and the
// chosen day (`selected`). It is not a date picker: use DateField to type or pick one date in a form.
// Every day inside the month is a button (44px, 48px on touch); `aria-pressed` marks the selected day. Days of the
// neighbouring months fill the first and last week as blank cells, so every day on screen belongs to the month.
function MonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  renderDay,
  minDate,
  maxDate,
  weekStartsOn = 0,
  today = seoulToday(),
  className,
}: {
  /** Any day of the month to show (`YYYY-MM-DD`). */
  month: string;
  onMonthChange: (day: string) => void;
  selected?: string | null;
  /** Without it the days are not buttons. */
  onSelect?: (day: string) => void;
  /** Content under the day number, for example a dot or a count. A month with no data still renders. */
  renderDay?: (day: string) => ReactNode;
  minDate?: string;
  maxDate?: string;
  weekStartsOn?: 0 | 1;
  today?: string;
  className?: string;
}) {
  const valid = isDate(month);
  const weeks = monthWeeks(month, weekStartsOn);
  const heads = Array.from({ length: 7 }, (_, i) => weekdayNames[(weekStartsOn + i) % 7]);
  const prefix = month.slice(0, 7);
  const title = monthTitle(month);
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const previousOff =
    !valid || (minDate !== undefined && `${previous.slice(0, 7)}` < minDate.slice(0, 7));
  const nextOff = !valid || (maxDate !== undefined && `${next.slice(0, 7)}` > maxDate.slice(0, 7));
  return (
    <div data-slot="month-calendar" className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          disabled={previousOff}
          onClick={() => onMonthChange(previous)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div aria-live="polite" className="text-body-sm font-semibold">
          {title || monthNames[0]}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next month"
          disabled={nextOff}
          onClick={() => onMonthChange(next)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <table aria-label={title} className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {heads.map((name) => (
              <th
                key={name}
                scope="col"
                abbr={name}
                className="pb-1 text-caption font-medium text-muted-foreground"
              >
                {name.slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                if (!day.startsWith(prefix)) return <td key={day} aria-hidden="true" />;
                const off =
                  (minDate !== undefined && day < minDate) ||
                  (maxDate !== undefined && day > maxDate);
                const isSelected = day === selected;
                const face = (
                  <>
                    <span className="tabular-nums">{Number(day.slice(8))}</span>
                    {renderDay?.(day)}
                  </>
                );
                const cell = cn(
                  'flex min-h-11 w-full flex-col items-center justify-start gap-0.5 rounded-md py-1 text-body-sm pointer-coarse:min-h-12',
                  day === today && 'ring-1 ring-ring',
                );
                return (
                  <td key={day} className="p-0.5 align-top">
                    {onSelect ? (
                      <button
                        type="button"
                        aria-label={longDate(day)}
                        aria-pressed={isSelected}
                        aria-current={day === today ? 'date' : undefined}
                        disabled={off}
                        onClick={() => onSelect(day)}
                        className={cn(
                          cell,
                          'cursor-pointer outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-primary aria-pressed:text-primary-foreground',
                        )}
                      >
                        {face}
                      </button>
                    ) : (
                      <div
                        aria-label={longDate(day)}
                        role="group"
                        aria-current={day === today ? 'date' : undefined}
                        className={cn(cell, off && 'opacity-50')}
                      >
                        {face}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { MonthCalendar };
