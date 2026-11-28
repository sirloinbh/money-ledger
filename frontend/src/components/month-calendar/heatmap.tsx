// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/month-calendar/
import { cn } from '../../lib/utils';
import { addDays, longDate, monthNames, weekdayNames, weekdayOf } from '../ui/date-fields';
import { bandLabels, bandLevel, maxBands } from './heatmap-bands';

const shades = [
  'bg-accent',
  'bg-primary/25',
  'bg-primary/50',
  'bg-primary/75',
  'bg-primary',
] as const;

// A calendar heatmap (#18): one square per day, shaded by how much happened. `values` maps a day (`YYYY-MM-DD`) to a
// number; `bands` is the ordered list of thresholds, so `[1, 3, 6]` makes four levels: 0, 1 to 2, 3 to 5 and 6 or more.
// Color is never the only signal: every square has an accessible label with its value, and a legend lists what each
// shade means in words. The grid scrolls sideways in its frame on a narrow screen.

function Heatmap({
  values,
  bands,
  from,
  to,
  label,
  unit = '',
  weekStartsOn = 0,
  className,
}: {
  values: Record<string, number>;
  /** Ascending thresholds, at most 4 (five shades with the empty level). */
  bands: number[];
  /** First and last day shown; the grid is whole weeks around them. */
  from: string;
  to: string;
  /** What the heatmap shows, for example "Workouts per day". Names the region. */
  label: string;
  /** Word after a value in a square's label, for example "workouts". */
  unit?: string;
  weekStartsOn?: 0 | 1;
  className?: string;
}) {
  const levels = bands.slice(0, maxBands);
  const start = addDays(from, -((weekdayOf(from) - weekStartsOn + 7) % 7));
  const total = Math.max(1, Math.ceil((daysBetween(start, to) + 1) / 7));
  const weeks = Array.from({ length: total }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );
  const labels = bandLabels(levels);
  return (
    <figure data-slot="heatmap" className={cn('flex flex-col gap-2', className)}>
      <figcaption className="text-body-sm font-medium">{label}</figcaption>
      <div
        role="region"
        aria-label={label}
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
        tabIndex={0}
        className="overflow-x-auto rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex w-max gap-2">
          <div
            className="flex flex-col gap-0.5 pt-5 text-meta text-muted-foreground"
            aria-hidden="true"
          >
            {Array.from({ length: 7 }, (_, d) => (
              <span key={d} className="flex h-3.5 items-center">
                {d % 2 === 1 ? weekdayNames[(weekStartsOn + d) % 7].slice(0, 3) : ''}
              </span>
            ))}
          </div>
          <div className="flex gap-0.5">
            {weeks.map((week) => {
              const first = week.find((day) => day >= from && day.slice(8) === '01') ?? null;
              return (
                <div key={week[0]} className="flex flex-col gap-0.5">
                  <span
                    className="h-5 text-meta whitespace-nowrap text-muted-foreground"
                    aria-hidden="true"
                  >
                    {first ? monthNames[Number(first.slice(5, 7)) - 1].slice(0, 3) : ''}
                  </span>
                  {week.map((day) => {
                    const inRange = day >= from && day <= to;
                    if (!inRange) return <span key={day} className="size-3.5" aria-hidden="true" />;
                    const value = values[day];
                    const text = `${longDate(day)}: ${value ?? 0}${unit ? ` ${unit}` : ''}`;
                    return (
                      <span
                        key={day}
                        role="img"
                        aria-label={text}
                        title={text}
                        data-level={bandLevel(value, levels)}
                        className={cn('size-3.5 rounded-sm', shades[bandLevel(value, levels)])}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <ul
        data-slot="heatmap-legend"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground"
      >
        {labels.map((text, level) => (
          <li key={text} className="flex items-center gap-1">
            <span aria-hidden="true" className={cn('size-3.5 rounded-sm', shades[level])} />
            <span>
              {text}
              {unit ? ` ${unit}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export { Heatmap };
