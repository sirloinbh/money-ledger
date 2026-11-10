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

import { formatWon } from './format';
import { dayLabel, dayValue, type Snapshot, timeTicks, wonAxisLabel } from './net-worth';

// #49 Net worth over time as one line (decisions 2026-11-10). The x axis is real time, so days without a save
// keep their width and the line joins the saved days on either side; nothing is drawn as 0. Every saved day has
// a dot. The exact values are in the table under the chart, so the chart is one image for screen readers.
// Colors: --chart-series-1 (index.css) for the line, text tokens for every label.

type Point = Snapshot & { day: number };

const oneDay = 86_400_000;

function NetWorthTooltip({ active, payload }: TooltipContentProps) {
  const point = active ? (payload[0]?.payload as Point | undefined) : undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-body-sm text-popover-foreground shadow-sm">
      <p className="font-medium">{dayLabel(point.date)}</p>
      <p className="tabular-nums">순자산 {formatWon(point.netKrw)}</p>
      <p className="text-muted-foreground tabular-nums">
        자산 {formatWon(point.assetsKrw)} · 부채 {formatWon(point.debtsKrw)}
      </p>
      {point.uncounted > 0 ? (
        <p className="text-muted-foreground">{point.uncounted}개 빠짐</p>
      ) : null}
    </div>
  );
}

/**
 * `snapshots` oldest first, at least one. The axis runs from `from` (the period's first day, or the first save
 * for the whole history) to `to` (today).
 */
export function NetWorthChart({
  snapshots,
  from,
  to,
}: {
  snapshots: Snapshot[];
  from: string;
  to: string;
}) {
  const points: Point[] = snapshots.map((snapshot) => ({
    ...snapshot,
    day: dayValue(snapshot.date),
  }));
  const start = dayValue(from);
  // One day is no span: widen it so the single dot sits in the middle.
  const end = Math.max(dayValue(to), start + oneDay);
  const axis = timeTicks(start, end);
  const negative = snapshots.some((snapshot) => snapshot.netKrw < 0);
  const latest = snapshots[snapshots.length - 1];
  return (
    <div
      role="img"
      aria-label={`${dayLabel(from)}부터 ${dayLabel(to)}까지 순자산 꺾은선 차트. 기록은 ${snapshots.length}일이고 마지막 기록(${dayLabel(latest.date)})은 ${formatWon(latest.netKrw)}입니다. 모든 값은 아래 표로 보기에 있습니다.`}
      className="h-64 w-full sm:h-72"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="day"
            domain={[start, end]}
            ticks={axis.ticks}
            tickFormatter={axis.label}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            width={56}
            tickFormatter={wonAxisLabel(snapshots.map((snapshot) => snapshot.netKrw))}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={['auto', 'auto']}
          />
          {negative ? (
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
          ) : null}
          <Tooltip
            content={NetWorthTooltip}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="netKrw"
            name="순자산"
            type="linear"
            stroke="var(--chart-series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={{ r: 3, fill: 'var(--chart-series-1)', stroke: 'var(--card)', strokeWidth: 2 }}
            activeDot={{
              r: 5,
              fill: 'var(--chart-series-1)',
              stroke: 'var(--card)',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
