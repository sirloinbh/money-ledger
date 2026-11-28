// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/score-field/
// The values from min to max in steps of `step`, rounded so 0.5 steps do not drift (0.1 + 0.2 style sums).
export function scoreValues(min: number, max: number, step: number): number[] {
  const count = Math.floor((max - min) / step + 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Math.round((min + i * step) * 1e6) / 1e6);
}
