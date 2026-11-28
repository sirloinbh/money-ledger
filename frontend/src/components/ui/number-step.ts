// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
// A plain decimal: digits with at most one decimal point, optionally negative so a schema's
// range message can answer "-1". A comma is never accepted: "1,000" uses it as a thousands
// separator, and reading it as a decimal comma would save 1 for 1,000.
// Number() alone would also read "0x10", "1e3" or "Infinity" and send a value nobody typed.
const plainNumber = /^-?(\d+(\.\d*)?|\.\d+)$/;

// The one reader for typed number text in forms and in the − / + stepper (#972).
// Empty stays null (not recorded, never 0); anything that is not a plain decimal becomes NaN, so
// the form's schema reports "Enter ... as a number" on that field instead of saving a guess.
// More than 15 significant digits is NaN too (health-log's `parseAmount`, #20): a double cannot hold
// them, so "12345678901234567" would be saved as a different number than the one typed.
const maxSignificantDigits = 15;

export const optionalNumber = (value: string) => {
  const text = value.trim();
  if (text === '') return null;
  if (!plainNumber.test(text)) return Number.NaN;
  const significant = text.replace(/[-.]/g, '').replace(/^0+/, '');
  return significant.length > maxSignificantDigits ? Number.NaN : Number(text);
};

const decimals = (value: number) => (String(value).split('.')[1] ?? '').length;

// The next value after a press of − or +. An empty or unreadable field counts as the minimum
// (or 0). Rounding to the longer of the value's and the step's decimals keeps 0.1 + 0.2 from
// showing as 0.30000000000000004 without cutting a typed 12.25.
export function stepValue(current: string, delta: number, min?: number, max?: number): string {
  const parsed = optionalNumber(current);
  const base = parsed !== null && Number.isFinite(parsed) ? parsed : (min ?? 0);
  const next = Number((base + delta).toFixed(Math.max(decimals(base), decimals(delta))));
  const low = min === undefined ? next : Math.max(min, next);
  return String(max === undefined ? low : Math.min(max, low));
}
