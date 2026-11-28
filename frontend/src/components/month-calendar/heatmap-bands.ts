// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/month-calendar/
// Levels and legend words for Heatmap (#18).

/** At most this many thresholds: five shades with the empty level. */
export const maxBands = 4;

/** The level (0 up to the number of bands) of a value: how many thresholds it reaches. */
export function bandLevel(value: number | undefined, bands: number[]) {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return bands.filter((threshold) => value >= threshold).length;
}

/** What each level means in words: bands [1, 3, 6] give "0", "1–2", "3–5", "6+". */
export function bandLabels(bands: number[]) {
  const first = bands[0];
  const labels = [first === undefined || first <= 1 ? '0' : `0–${first - 1}`];
  bands.forEach((threshold, i) => {
    const next = bands[i + 1];
    if (next === undefined) labels.push(`${threshold}+`);
    else labels.push(next - 1 === threshold ? `${threshold}` : `${threshold}–${next - 1}`);
  });
  return labels;
}
