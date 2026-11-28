// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/chart/
// Shared numbers for BarChart and LineChart (#1176).

export type ChartPoint = { label: string; value: number };

/** The top of the value axis: the largest value rounded up to 1, 2, 2.5, 5 or 10 times a power of ten. Never 0. */
export function niceMax(values: number[]) {
  const max = Math.max(0, ...values.filter(Number.isFinite));
  if (max === 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max) ?? 10;
  return step * power;
}

/** Share of the axis (0 to 1) that `value` fills, kept inside the axis. */
export function share(value: number, axisMax: number) {
  if (!Number.isFinite(value) || axisMax <= 0) return 0;
  return Math.min(1, Math.max(0, value / axisMax));
}

/** "1,200" or "12.5"; plain English number formatting regardless of the browser language. */
export const formatValue = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
