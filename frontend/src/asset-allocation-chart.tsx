import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';

import { formatWon } from './format';

// #48 Asset allocation as horizontal bars, the same look as #40's category chart (decision 2026-11-10).
// One series, so no legend: the tab names it. The exact values are in the table below the chart, so the chart
// is one image for screen readers. Colors: --chart-series-1 (index.css) for the bars, text tokens for labels.

/** `value` is the share as a number, for the bar length only; the label shows `share` as the server sent it. */
export type AllocationBar = {
  key: string;
  name: string;
  amountKrw: number | null;
  share: string;
  value: number;
};

const rowHeight = 36;
const nameLength = 8;

/** Long names are cut on the axis only; the tooltip and the table show them whole. */
const shortName = (name: string) =>
  name.length > nameLength ? `${name.slice(0, nameLength - 1)}…` : name;

/** The won amount, or a note when it is too large to show exactly (the table says the same). */
const amountText = (amount: number | null) =>
  amount === null ? '금액이 너무 커 표시 불가' : formatWon(amount);

function ShareTooltip({ active, payload }: TooltipContentProps) {
  const bar = active ? (payload[0]?.payload as AllocationBar | undefined) : undefined;
  if (!bar) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-body-sm text-popover-foreground shadow-sm">
      <p className="font-medium">{bar.name}</p>
      <p className="tabular-nums">
        {amountText(bar.amountKrw)} · {bar.share}%
      </p>
    </div>
  );
}

/** `bars` largest first, at least one. `title` names what is spread (종류별 / 종목별). */
export function AssetAllocationChart({ bars, title }: { bars: AllocationBar[]; title: string }) {
  const height = bars.length * rowHeight + 32;
  const largest = bars[0];
  return (
    <div
      role="img"
      aria-label={`${title} 자산 배분 가로 막대 차트. 가장 큰 항목은 ${largest.name} ${amountText(largest.amountKrw)}(${largest.share}%)입니다. 모든 값은 아래 표에 있습니다.`}
      className="w-full"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bars}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 0 }}
          barCategoryGap={6}
          accessibilityLayer={false}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="value"
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="key"
            width={88}
            tickFormatter={(key: string) =>
              shortName(bars.find((bar) => bar.key === key)?.name ?? key)
            }
            tick={{ fill: 'var(--foreground)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <Tooltip
            content={ShareTooltip}
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="value"
            fill="var(--chart-series-1)"
            maxBarSize={24}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="share"
              position="right"
              formatter={(value) => `${String(value)}%`}
              fill="var(--muted-foreground)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
