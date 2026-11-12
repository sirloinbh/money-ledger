import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';

import { formatWon, signedPercent } from './format';
import { formatMonthDay } from './quote-format';

// #54 Return of the mock account by day as one line (decision 2026-11-10). One series, so no legend: the card
// title names it. Every value is also in the table under the chart, so the chart is one image for screen
// readers. Colors: --chart-series-1 (index.css) for the line, text tokens for every label, as in #40.

export type ReturnPoint = { date: string; totalKrw: number; profitKrw: number; returnPct: string };

function ReturnTooltip({ active, payload }: TooltipContentProps) {
  const point = active
    ? (payload[0]?.payload as (ReturnPoint & { value: number }) | undefined)
    : undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-body-sm text-popover-foreground shadow-sm">
      <p className="font-medium">{formatMonthDay(point.date)}</p>
      <p className="tabular-nums">
        {signedPercent(point.returnPct)} · total assets {formatWon(point.totalKrw)}
      </p>
    </div>
  );
}

export function MockReturnChart({ points }: { points: ReturnPoint[] }) {
  // Numbers only for drawing; the labels use the decimal text from the server.
  const data = points.map((point) => ({ ...point, value: Number(point.returnPct) }));
  const last = points.at(-1)!;
  return (
    <div
      role="img"
      aria-label={`Return by date line chart. From ${formatMonthDay(points[0].date)} to ${formatMonthDay(last.date)}, the latest return is ${signedPercent(last.returnPct)}. All values are in the table below.`}
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) => formatMonthDay(date)}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          <Tooltip content={ReturnTooltip} cursor={{ stroke: 'var(--border)' }} />
          <Line
            dataKey="value"
            stroke="var(--chart-series-1)"
            strokeWidth={2}
            dot={points.length <= 31}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
