// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/progress-bar/
import { useId } from 'react';

import { cn } from '../../lib/utils';

// A named progress bar (#7). The track is `role="progressbar"` with aria-valuenow, -valuemin, -valuemax and
// -valuetext, so a screen reader says "Storage, 40 of 100 GB". Without a value the bar is indeterminate (no
// aria-valuenow). Track and fill use theme tokens, and the visible label and value text are 12px or larger.
function ProgressBar({
  label,
  value,
  max = 100,
  valueText,
  hideLabel = false,
  className,
}: {
  /** What is progressing, for example "Storage used". Always the accessible name. */
  label: string;
  /** Current value from 0 to `max`; leave it out while the amount is unknown. */
  value?: number | null;
  max?: number;
  /** Spoken and shown text for the value, for example "40 of 100 GB". Defaults to a percentage. */
  valueText?: string;
  /** Hide the visible label; it still names the bar. */
  hideLabel?: boolean;
  className?: string;
}) {
  const labelId = useId();
  const known = typeof value === 'number' && Number.isFinite(value) && max > 0;
  const clamped = known ? Math.min(max, Math.max(0, value)) : 0;
  const percent = known ? (clamped / max) * 100 : 0;
  const text = known ? (valueText ?? `${Math.round(percent)}%`) : valueText;
  return (
    <div data-slot="progress-bar" className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-3 text-body-sm">
        <span id={labelId} className={cn(hideLabel && 'sr-only')}>
          {label}
        </span>
        {text && !hideLabel && <span className="text-muted-foreground tabular-nums">{text}</span>}
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={known ? clamped : undefined}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-full bg-accent"
      >
        <div
          className={cn(
            'h-full rounded-full bg-primary',
            known
              ? 'transition-[width] motion-reduce:transition-none'
              : 'w-1/3 animate-pulse motion-reduce:animate-none',
          )}
          style={known ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}

export { ProgressBar };
