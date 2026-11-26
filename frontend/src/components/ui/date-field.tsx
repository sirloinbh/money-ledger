// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';
import {
  addDays,
  addMonths,
  clampDate,
  formatTime,
  isDate,
  longDate,
  monthTitle,
  monthWeeks,
  parseTime,
  seoulToday,
  weekdayNames,
  weekdayOf,
} from './date-fields';
import { Input } from './input';

// An English date and time field (#1138). The browser's own date and time inputs write their parts
// and calendar in the browser's language (the year / month / day labels follow it), and `lang` does not change that. These
// are a text field (type `2026-11-27`, paste, or clear) plus a popover to pick. The value is a
// string like the kit's other fields: a full `YYYY-MM-DD` / `HH:MM`, or whatever is typed so far,
// or "" when cleared. The form and the server still validate it; `min` and `max` only limit what
// the calendar lets you pick (and what the arrow keys reach), as the native input's did.

type FieldProps = Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'aria-label' | 'children' | 'children'
>;

const popoverClass =
  'z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none';
const cell =
  'flex size-10 items-center justify-center rounded-md text-body-sm outline-none pointer-coarse:size-12 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 group-aria-selected:bg-primary group-aria-selected:text-primary-foreground aria-[current=date]:font-semibold aria-[current=date]:underline';

function Month({
  value,
  min,
  max,
  today,
  weekStartsOn,
  onPick,
}: {
  value: string;
  min?: string;
  max?: string;
  today: string;
  weekStartsOn: 0 | 1;
  onPick: (day: string) => void;
}) {
  // The day that holds focus (and so decides the month shown): the value, else today, within the limits.
  const [focused, setFocused] = useState(() => clampDate(isDate(value) ? value : today, min, max));
  const grid = useRef<HTMLTableElement>(null);
  // Focus the day when the calendar opens and after a key moved it, not after a click on the month buttons.
  const focusNext = useRef(true);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    grid.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
  });
  const weeks = monthWeeks(focused, weekStartsOn);
  const heads = Array.from({ length: 7 }, (_, i) => weekdayNames[(weekStartsOn + i) % 7]);
  const focusDay = (day: string) => {
    focusNext.current = true;
    setFocused(clampDate(day, min, max));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step: Record<string, string> = {
      ArrowLeft: addDays(focused, -1),
      ArrowRight: addDays(focused, 1),
      ArrowUp: addDays(focused, -7),
      ArrowDown: addDays(focused, 7),
      PageUp: addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: addMonths(focused, event.shiftKey ? 12 : 1),
      Home: addDays(focused, -((weekdayOf(focused) - weekStartsOn + 7) % 7)),
      End: addDays(focused, 6 - ((weekdayOf(focused) - weekStartsOn + 7) % 7)),
    };
    if (step[event.key]) {
      event.preventDefault();
      focusDay(step[event.key]);
    }
  };
  const outside = (day: string) => (min !== undefined && day < min) || (max !== undefined && day > max);
  const month = focused.slice(0, 7);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setFocused(addMonths(focused, -1))}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <div aria-live="polite" className="text-body-sm font-semibold">
          {monthTitle(focused)}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setFocused(addMonths(focused, 1))}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
      <table ref={grid} role="grid" aria-label={monthTitle(focused)} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {heads.map((name) => (
              <th key={name} scope="col" abbr={name} className="text-caption font-medium text-muted-foreground">
                {name.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => (
                <td key={day} role="gridcell" aria-selected={day === value} className="group p-0 text-center">
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === focused ? 0 : -1}
                    aria-label={longDate(day)}
                    aria-current={day === today ? 'date' : undefined}
                    disabled={outside(day)}
                    className={cn(cell, !day.startsWith(month) && 'text-muted-foreground')}
                    onClick={() => onPick(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The text field, the button that opens the popover, and the popover. `children` is the popover body.
function PickerField({
  label,
  value,
  onValueChange,
  placeholder,
  maxLength,
  icon,
  openLabel,
  className,
  children,
  ...props
}: FieldProps & {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  icon: 'calendar' | 'clock';
  openLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = icon === 'calendar' ? CalendarIcon : ClockIcon;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div data-slot="date-field" className={cn('flex items-center gap-1', className)}>
          <Input
            {...props}
            type="text"
            autoComplete="off"
            placeholder={placeholder}
            maxLength={maxLength}
            aria-label={label}
            className="min-w-0 flex-1"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
          <PopoverPrimitive.Trigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={openLabel}
              disabled={props.disabled || props.readOnly}
            >
              <Icon aria-hidden />
            </Button>
          </PopoverPrimitive.Trigger>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          aria-label={icon === 'calendar' ? 'Calendar' : 'Time list'}
          className={popoverClass}
        >
          {children(() => setOpen(false))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// `YYYY-MM-DD`. `min` and `max` are days; `today` (default: today in Asia/Seoul) is marked on the
// calendar; `required` hides Clear; weeks start on Sunday unless `weekStartsOn={1}`.
export function DateField({
  label,
  value,
  onValueChange,
  min,
  max,
  today = seoulToday(),
  weekStartsOn = 0,
  required,
  ...props
}: FieldProps & {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  today?: string;
  weekStartsOn?: 0 | 1;
}) {
  const name = label ?? 'date';
  return (
    <PickerField
      {...props}
      label={label}
      required={required}
      value={value}
      onValueChange={onValueChange}
      placeholder="YYYY-MM-DD"
      maxLength={10}
      icon="calendar"
      openLabel={`Pick ${name.charAt(0).toLowerCase()}${name.slice(1)} from a calendar`}
    >
      {(close) => (
        <>
          <Month
            value={value}
            min={min}
            max={max}
            today={today}
            weekStartsOn={weekStartsOn}
            onPick={(day) => {
              onValueChange(day);
              close();
            }}
          />
          <div className="mt-2 flex justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={(min !== undefined && today < min) || (max !== undefined && today > max)}
              onClick={() => {
                onValueChange(today);
                close();
              }}
            >
              Today
            </Button>
            {!required && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onValueChange('');
                  close();
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </>
      )}
    </PickerField>
  );
}

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const minutes = Array.from({ length: 12 }, (_, step) => step * 5);

// `HH:MM` on a 24-hour clock. The popover picks the hour and the minute (in 5-minute steps; any
// minute can be typed).
export function TimeField({
  label,
  value,
  onValueChange,
  ...props
}: FieldProps & { label?: string; value: string; onValueChange: (value: string) => void }) {
  const name = label ?? 'time';
  const parts = parseTime(value);
  const pick = (hour: number, minute: number) => onValueChange(formatTime(hour, minute));
  return (
    <PickerField
      {...props}
      label={label}
      value={value}
      onValueChange={onValueChange}
      placeholder="HH:MM"
      maxLength={5}
      icon="clock"
      openLabel={`Pick ${name.charAt(0).toLowerCase()}${name.slice(1)} from a list`}
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Hour">
            <div className="mb-1 text-caption font-medium text-muted-foreground">Hour</div>
            <div className="grid grid-cols-6 gap-1">
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  aria-label={`Hour ${hour}`}
                  aria-pressed={parts?.hour === hour}
                  className={cn(cell, 'aria-pressed:bg-primary aria-pressed:text-primary-foreground')}
                  onClick={() => pick(hour, parts?.minute ?? 0)}
                >
                  {String(hour).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Minute">
            <div className="mb-1 text-caption font-medium text-muted-foreground">Minute</div>
            <div className="grid grid-cols-6 gap-1">
              {minutes.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  aria-label={`Minute ${minute}`}
                  aria-pressed={parts?.minute === minute}
                  className={cn(cell, 'aria-pressed:bg-primary aria-pressed:text-primary-foreground')}
                  onClick={() => {
                    pick(parts?.hour ?? 0, minute);
                    close();
                  }}
                >
                  {String(minute).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </PickerField>
  );
}
