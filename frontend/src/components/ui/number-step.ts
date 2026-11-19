// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
const decimals = (value: number) => (String(value).split('.')[1] ?? '').length;

// The next value after a press of − or +. An empty or unreadable field counts as the minimum
// (or 0). Rounding to the longer of the value's and the step's decimals keeps 0.1 + 0.2 from
// showing as 0.30000000000000004 without cutting a typed 12.25.
export function stepValue(current: string, delta: number, min?: number, max?: number): string {
  const parsed = Number(current);
  const base = current.trim() && Number.isFinite(parsed) ? parsed : (min ?? 0);
  const next = Number((base + delta).toFixed(Math.max(decimals(base), decimals(delta))));
  const low = min === undefined ? next : Math.max(min, next);
  return String(max === undefined ? low : Math.min(max, low));
}
