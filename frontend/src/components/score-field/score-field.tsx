// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/score-field/
import { useId } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { scoreValues } from './score-values';

// A rating on native radio buttons, so the browser gives arrow key movement, one tab stop and the announced state
// ("3, radio button, 3 of 5"). `value` is the chosen number or null for "no rating"; Clear returns to null.
// `lowLabel` and `highLabel` name the two ends ("Poor", "Great") and are read as the group's description.
function ScoreField({
  label,
  value,
  onChange,
  min = 1,
  max = 5,
  step = 1,
  lowLabel,
  highLabel,
  clearLabel = 'Clear',
  allowClear = true,
  disabled,
  name,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  lowLabel?: string;
  highLabel?: string;
  clearLabel?: string;
  allowClear?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
}) {
  const id = useId();
  const group = name ?? `score-${id}`;
  return (
    <fieldset
      data-slot="score-field"
      disabled={disabled}
      aria-describedby={lowLabel || highLabel ? `${id}-hint` : undefined}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      <legend className="mb-1 text-body-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {scoreValues(min, max, step).map((n) => (
          <label
            key={n}
            className="relative inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-body-sm font-medium transition-colors hover:bg-accent has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50 pointer-coarse:min-h-12 pointer-coarse:min-w-12"
          >
            <input
              type="radio"
              name={group}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-md outline-none disabled:cursor-not-allowed"
            />
            <span>{n}</span>
          </label>
        ))}
        {allowClear && value !== null ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
      {lowLabel || highLabel ? (
        <p
          id={`${id}-hint`}
          className="flex justify-between gap-4 text-caption text-muted-foreground"
        >
          <span>{lowLabel}</span> <span>{highLabel}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

export { ScoreField };
