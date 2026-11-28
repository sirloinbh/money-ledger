// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/chart/
import { Component, type ReactNode, useId } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { type ChartPoint, formatValue, niceMax, share } from './chart-data';

// Small charts drawn without a charting library (#1176). Labels are HTML text, so the 12px floor holds at every width,
// and colors come from the theme tokens (`bg-primary`, `stroke-primary`, `border`, `text-muted-foreground`), so light
// and dark need no extra code. Every chart is a figure with a caption and the same values as a table: the table is read
// by screen readers, and ChartBoundary shows it when the chart cannot be drawn.

function ChartTable({
  caption,
  data,
  valueLabel = 'Value',
  className,
}: {
  caption: string;
  data: ChartPoint[];
  valueLabel?: string;
  className?: string;
}) {
  return (
    <table data-slot="chart-table" className={cn('text-body-sm', className)}>
      <caption className="text-left text-muted-foreground">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="pr-4 text-left font-medium">
            Label
          </th>
          <th scope="col" className="text-right font-medium">
            {valueLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((point, i) => (
          <tr key={`${point.label}-${i}`}>
            <th scope="row" className="pr-4 text-left font-normal">
              {point.label}
            </th>
            <td className="text-right">{formatValue(point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type ChartProps = {
  /** What the chart shows; the figure caption and the table caption. */
  title: string;
  data: ChartPoint[];
  /** Name of the value column in the table, for example "Minutes". */
  valueLabel?: string;
  className?: string;
};

function ChartFrame({
  title,
  data,
  valueLabel,
  className,
  children,
  slot,
}: ChartProps & { children: ReactNode; slot: string }) {
  const captionId = useId();
  return (
    <figure
      data-slot={slot}
      aria-labelledby={captionId}
      className={cn('flex flex-col gap-2', className)}
    >
      <figcaption id={captionId} className="text-body-sm font-medium">
        {title}
      </figcaption>
      {data.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">No data to show.</p>
      ) : (
        <>
          <div aria-hidden="true">{children}</div>
          <ChartTable caption={title} data={data} valueLabel={valueLabel} className="sr-only" />
        </>
      )}
    </figure>
  );
}

/** Vertical bars from zero. The value sits above each bar and the label under it, both 12px or larger. */
function BarChart({ title, data, valueLabel, className }: ChartProps) {
  const top = niceMax(data.map((p) => p.value));
  return (
    <ChartFrame
      slot="bar-chart"
      title={title}
      data={data}
      valueLabel={valueLabel}
      className={className}
    >
      <div className="flex h-44 items-end gap-1 border-b border-border">
        {data.map((point, i) => (
          <div
            key={`${point.label}-${i}`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${point.label}: ${formatValue(point.value)}`}
          >
            <span className="truncate text-center text-meta text-muted-foreground">
              {formatValue(point.value)}
            </span>
            <div
              className="w-full rounded-t-sm bg-primary"
              style={{ height: `${share(point.value, top) * 85}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((point, i) => (
          <span
            key={`${point.label}-${i}`}
            className="min-w-0 flex-1 truncate text-center text-meta text-muted-foreground"
          >
            {point.label}
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

/** A line through the points, with a dot on each. The axis runs from zero to a round top shown at the corner. */
function LineChart({ title, data, valueLabel, className }: ChartProps) {
  const top = niceMax(data.map((p) => p.value));
  const x = (i: number) => (data.length === 1 ? 50 : (i / (data.length - 1)) * 100);
  const y = (value: number) => 100 - share(value, top) * 100;
  const path = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  return (
    <ChartFrame
      slot="line-chart"
      title={title}
      data={data}
      valueLabel={valueLabel}
      className={className}
    >
      <div className="flex gap-2">
        <div className="flex h-44 flex-col justify-between text-right text-meta text-muted-foreground">
          <span>{formatValue(top)}</span>
          <span>0</span>
        </div>
        <div className="relative mx-2 h-44 min-w-0 flex-1 border-b border-l border-border">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            focusable="false"
          >
            <path
              d={path}
              fill="none"
              className="stroke-primary"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {data.map((point, i) => (
            <span
              key={`${point.label}-${i}`}
              title={`${point.label}: ${formatValue(point.value)}`}
              className="absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary"
              style={{ left: `${x(i)}%`, bottom: `${100 - y(point.value)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 ml-10 flex justify-between gap-1 text-meta text-muted-foreground">
        <span className="truncate">{data[0]?.label}</span>
        {data.length > 1 && <span className="truncate">{data.at(-1)?.label}</span>}
      </div>
    </ChartFrame>
  );
}

/**
 * Catches a chart that throws (or whose lazy module fails to load). It shows a message that points to the table with
 * the same values, and a retry button. Pass `data` to show that table; without it only the message appears.
 */
class ChartBoundary extends Component<
  { children: ReactNode; title?: string; data?: ChartPoint[]; valueLabel?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { title = 'Chart', data, valueLabel } = this.props;
    return (
      <div data-slot="chart-boundary" role="alert" className="flex flex-col gap-3">
        <p className="text-body-sm">
          The chart could not be drawn.{data ? ' The same values are in the table below.' : ''}
        </p>
        <div>
          <Button type="button" variant="outline" onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
        </div>
        {data && <ChartTable caption={title} data={data} valueLabel={valueLabel} />}
      </div>
    );
  }
}

export { BarChart, ChartBoundary, ChartTable, LineChart };
