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
import type { CategoryShare } from './monthly-summary';

// #40 Expense by category as horizontal bars (2026-11-08 decision: easy to read with many categories).
// One series, so no legend: the card title names it. The exact values are in the table below the chart,
// so the chart is one image for screen readers. Colors: --chart-series-1 (index.css) for the bars, text tokens
// for every label.

const rowHeight = 36;
const nameLength = 8;

/** Long names are cut on the axis only; the tooltip and the table show them whole. */
const shortName = (name: string) =>
  name.length > nameLength ? `${name.slice(0, nameLength - 1)}…` : name;

/** Axis ticks: 0 / 5만 / 10만 … in 만원, full numbers below 10,000. */
const compactWon = (value: number) =>
  value >= 10_000
    ? `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value / 10_000)}만`
    : new Intl.NumberFormat('ko-KR').format(value);

function ShareTooltip({ active, payload }: TooltipContentProps) {
  const category = active ? (payload[0]?.payload as CategoryShare | undefined) : undefined;
  if (!category) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-body-sm text-popover-foreground shadow-sm">
      <p className="font-medium">{category.hidden ? `${category.name} (숨김)` : category.name}</p>
      <p className="tabular-nums">
        {formatWon(category.amount)} · {category.share}%
      </p>
    </div>
  );
}

export function CategoryShareChart({ categories }: { categories: CategoryShare[] }) {
  const height = categories.length * rowHeight + 32;
  const largest = categories[0];
  return (
    <div
      role="img"
      aria-label={`카테고리별 지출 가로 막대 차트. 가장 큰 항목은 ${largest.name} ${formatWon(largest.amount)}(${largest.share}%)입니다. 모든 값은 아래 표에 있습니다.`}
      className="w-full"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={categories}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 0 }}
          barCategoryGap={6}
          accessibilityLayer={false}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="amount"
            tickFormatter={compactWon}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={88}
            tickFormatter={shortName}
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
            dataKey="amount"
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
