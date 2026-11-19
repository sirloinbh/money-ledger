// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import * as React from 'react';

import { cn } from '../../lib/utils';
import { fieldClasses } from './input-styles';

// A multi-line field that looks like Input (#688). With `limit` it shows a counter ("12/200") that is linked to the
// field with aria-describedby, and past the limit it says so in words ("3 over the limit") and sets aria-invalid,
// so the state is not colour only. `limit` is a soft limit: typing is not blocked, so pasted text is not cut off
// silently; the screen decides what to do with an over-limit value. Works controlled (`value`) and uncontrolled.

type TextareaProps = Omit<React.ComponentProps<'textarea'>, 'maxLength'> & {
  /** Soft character limit; shows a counter. */
  limit?: number;
};

function Textarea({ className, limit, value, defaultValue, onChange, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: TextareaProps) {
  const counterId = React.useId();
  const [typed, setTyped] = React.useState(String(defaultValue ?? '').length);
  const length = value === undefined ? typed : String(value).length;
  const over = limit !== undefined && length > limit;

  const field = (
    <textarea
      data-slot="textarea"
      className={cn('flex min-h-20 py-2 field-sizing-content pointer-coarse:min-h-24', fieldClasses, className)}
      value={value}
      defaultValue={defaultValue}
      onChange={(event) => {
        setTyped(event.target.value.length);
        onChange?.(event);
      }}
      aria-invalid={over || invalid ? true : undefined}
      aria-describedby={limit === undefined ? describedBy : [describedBy, counterId].filter(Boolean).join(' ')}
      {...props}
    />
  );
  if (limit === undefined) return field;
  return (
    <div data-slot="textarea-field" className="grid gap-1.5">
      {field}
      <p id={counterId} data-slot="textarea-counter" data-over={over || undefined} className={cn('text-caption text-muted-foreground', over && 'font-medium text-destructive')}>
        {length}/{limit}
        {over ? ` · ${length - limit} over the limit` : null}
      </p>
    </div>
  );
}

export { Textarea };
