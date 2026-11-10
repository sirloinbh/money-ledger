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
import { monthLabel, type TrendMonth, trendSeries } from './trend-series';

// #41 Income, expense and balance by month as three lines on one won axis. The legend above names each line
// (identity never by color alone); the exact values are in the table under the chart, so the chart is one image
// for screen readers. Colors: --chart-series-1..3 (index.css) for the lines, text tokens for every label.

/** Axis ticks in 만원 from 10,000 (and below -10,000), full numbers in between. */
const compactWon = (value: number) =>
  Math.abs(value) >= 10_000
    ? `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value / 10_000)}만`
    : new Intl.NumberFormat('ko-KR').format(value);

/** "2026-11" → "26.11" on the axis. */
const shortMonth = (month: string) => `${month.slice(2, 4)}.${month.slice(5)}`;

function TrendTooltip({ active, payload }: TooltipContentProps) {
  const month = active ? (payload[0]?.payload as TrendMonth | undefined) : undefined;
  if (!month) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-body-sm text-popover-foreground shadow-sm">
      <p className="font-medium">{monthLabel(month.month)}</p>
      {trendSeries.map((series) => (
        <p key={series.key} className="flex items-center gap-2 tabular-nums">
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ background: series.color }}
          />
          {series.label} {formatWon(month[series.key])}
        </p>
      ))}
    </div>
  );
}

export function TrendChart({ months }: { months: TrendMonth[] }) {
  const first = months[0].month;
  const last = months[months.length - 1].month;
  // Markers help find each month on a short period; on 24 months they crowd, so only the hovered one shows.
  const dots = months.length <= 12;
  const negative = months.some((month) => month.balance < 0);
  return (
    <div
      role="img"
      aria-label={`${monthLabel(first)}부터 ${monthLabel(last)}까지 월별 수입·지출·잔액 꺾은선 차트. 모든 값은 아래 표로 보기에 있습니다.`}
      className="flex w-full flex-col gap-2"
    >
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
        {trendSeries.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-4 rounded-full"
              style={{ background: series.color }}
            />
            {series.label}
          </li>
        ))}
      </ul>
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={months}
            margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonth}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              interval="equidistantPreserveStart"
              minTickGap={12}
            />
            <YAxis
              width={56}
              tickFormatter={compactWon}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            {negative ? (
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
            ) : null}
            <Tooltip
              content={TrendTooltip}
              cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {trendSeries.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                name={series.label}
                type="linear"
                stroke={series.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={
                  dots ? { r: 4, fill: series.color, stroke: 'var(--card)', strokeWidth: 2 } : false
                }
                activeDot={{ r: 5, fill: series.color, stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
