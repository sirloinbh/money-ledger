// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { MinusIcon, PlusIcon } from 'lucide-react';
import { type ComponentProps, useState } from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';
import { Input } from './input';
import { stepValue } from './number-step';

// kg and reps with − and + for one-handed entry. The value stays a string like the app's other
// form fields, so typing "12." is not rewritten; the form and the server still validate it.
// A button at its limit uses aria-disabled, not disabled, so keyboard focus stays on it.
// "Increase total weight kg": the label reads as part of a sentence.
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function NumberInput({
  label,
  value,
  onValueChange,
  step = 1,
  min,
  max,
  disabled,
  readOnly,
  inputMode,
  className,
  ...props
}: Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'min' | 'max' | 'step' | 'type' | 'aria-label'
> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const parsed = value.trim() ? Number(value) : Number.NaN;
  const atMin = min !== undefined && parsed <= min;
  const atMax = max !== undefined && parsed >= max;
  const limitClass = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';
  return (
    // #105: the group is not named after the field: the input already carries the name, and a
    // second element with the same label would make label lookups ambiguous.
    <div role="group" className={cn('flex items-center gap-1', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Decrease ${lowerFirst(label)}`}
        aria-disabled={atMin || undefined}
        className={limitClass}
        disabled={disabled || readOnly}
        onClick={() => {
          if (!atMin) onValueChange(stepValue(value, -step, min, max));
        }}
      >
        <MinusIcon aria-hidden />
      </Button>
      <Input
        {...props}
        type="text"
        inputMode={inputMode ?? (Number.isInteger(step) ? 'numeric' : 'decimal')}
        aria-label={label}
        className="min-w-0 flex-1 text-center"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Increase ${lowerFirst(label)}`}
        aria-disabled={atMax || undefined}
        className={limitClass}
        disabled={disabled || readOnly}
        onClick={() => {
          if (!atMax) onValueChange(stepValue(value, step, min, max));
        }}
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  );
}

// #105: NumberInput for a field kept as a number (like a set's weight and reps). The typed text
// is kept while it still reads as the stored number, so "12." or an emptied field is not
// rewritten mid-typing; a new number from outside (a − or + press, a restored draft) replaces it.
// A decimal comma (some phone keypads) counts as a point. Only digits with at most one point
// are taken, so the stored value is always finite (NaN would empty a saved draft) and pasted
// "0x10" or "1e3" is refused rather than read as 16 or 1000. A lone "." reads as 0 until the
// digits after it arrive, so ".5" can be typed.
// #1023: because of that the lowest value is 0 even when no `min` (or a negative one) is given, so the − button
// shows aria-disabled at 0 instead of doing nothing.
// #972: with allowEmpty the value may be undefined. An emptied field then stays undefined, never 0,
// so a required field shows its error when the form is saved; without it an emptied field reads as 0.
const typedNumber = /^\d*\.?\d*$/;
const readNumber = (text: string, allowEmpty: boolean) =>
  text === '' && allowEmpty ? undefined : text === '.' ? 0 : Number(text);
const showNumber = (value: number | undefined) => (value === undefined ? '' : String(value));
type NumberValueProps = Omit<ComponentProps<typeof NumberInput>, 'value' | 'onValueChange'> &
  (
    | { allowEmpty?: false; value: number; onValueChange: (value: number) => void }
    | {
        allowEmpty: true;
        value: number | undefined;
        onValueChange: (value: number | undefined) => void;
      }
  );
export function NumberValueInput({
  value,
  onValueChange,
  allowEmpty = false,
  min,
  ...props
}: NumberValueProps) {
  const [text, setText] = useState(showNumber(value));
  const shown = Object.is(readNumber(text, allowEmpty), value) ? text : showNumber(value);
  return (
    <NumberInput
      {...props}
      min={Math.max(0, min ?? 0)}
      value={shown}
      onValueChange={(next) => {
        const normalized = next.replace(',', '.');
        if (!typedNumber.test(normalized)) return;
        setText(normalized);
        // Without allowEmpty readNumber never returns undefined, so the narrower callback is safe.
        (onValueChange as (value: number | undefined) => void)(readNumber(normalized, allowEmpty));
      }}
    />
  );
}
