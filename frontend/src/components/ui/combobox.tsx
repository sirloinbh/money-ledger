// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import { type ComboboxGroup, filterComboboxGroups, maxComboboxOptions } from './combobox-filter';
import { Input } from './input';

// A text field with a filtered list of suggestions (#437, WAI-ARIA APG "list autocomplete with
// manual selection"). Typing a value that is not in the list is always allowed.
//   ↓/↑ open the list and move through it, Enter picks the highlighted option, Esc closes,
//   Tab leaves the field with the typed text as it is.
// Options are 44px tall on touch screens; a tap keeps focus in the field. No package: the list
// is plain DOM under the field, so it works inside dialogs and sheets as well. Filtering lives in
// combobox-filter.ts.

type Props = Omit<React.ComponentProps<'input'>, 'value' | 'list' | 'role'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Plain options, or titled groups such as "Recently used" and "Frequently used". */
  options: readonly string[] | readonly ComboboxGroup[];
  /** Accessible name of the suggestion list. It must not contain the field's own label:
   *  label lookups that match substrings would find the list too. */
  listLabel: string;
  /** Shown under the field when the typed text matches no option. Without it, nothing is shown. */
  emptyMessage?: React.ReactNode;
  maxOptions?: number;
};

const isGroups = (options: Props['options']): options is readonly ComboboxGroup[] => typeof options[0] === 'object';

function Combobox({
  value,
  onValueChange,
  options,
  listLabel,
  emptyMessage,
  maxOptions = maxComboboxOptions,
  id,
  className,
  onChange,
  onKeyDown,
  onBlur,
  ref,
  ...props
}: Props) {
  const generated = useId();
  const listId = `${id ?? generated}-listbox`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  const groups: readonly ComboboxGroup[] = isGroups(options) ? options : [{ label: '', options }];
  const filtered = filterComboboxGroups(groups, value, maxOptions);
  const flat = filtered.flatMap((group) => group.options);
  const shown = open ? flat : [];
  const expanded = shown.length > 0;
  const empty = open && !expanded && emptyMessage !== undefined && value.trim() !== '';
  const optionId = (i: number) => `${listId}-${i}`;

  // Esc closes the open list only. A dialog around the field listens for Esc on the document
  // in the capture phase, so the key is caught earlier, on the window, while the list is open.
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.activeElement !== input.current) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    };
    window.addEventListener('keydown', close, { capture: true });
    return () => window.removeEventListener('keydown', close, { capture: true });
  }, [expanded]);

  const pick = (option: string) => {
    onValueChange(option);
    setOpen(false);
    setActive(-1);
  };
  const move = (step: number) => {
    if (!flat.length) return;
    setOpen(true);
    setActive((current) => (!open || current < 0 ? (step > 0 ? 0 : flat.length - 1) : (current + step + flat.length) % flat.length));
  };

  let index = 0;
  const renderOption = (option: string) => {
    const i = index++;
    return (
      // Keys stay on the field (aria-activedescendant), as in the APG combobox pattern.
      // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events
      <li
        key={`${i}-${option}`}
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        data-slot="combobox-option"
        className={cn('flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm pointer-coarse:min-h-11', i === active && 'bg-accent text-accent-foreground')}
        onMouseEnter={() => setActive(i)}
        onClick={(event) => {
          // Inside a <label> the click would be passed on to the field and reopen the list.
          event.preventDefault();
          pick(option);
        }}
      >
        {option}
      </li>
    );
  };

  return (
    <div data-slot="combobox" className="relative">
      <Input
        {...props}
        ref={(node: HTMLInputElement | null) => {
          input.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        className={className}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        value={value}
        onChange={(event) => {
          onChange?.(event);
          onValueChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
          } else if (event.key === 'Enter' && expanded && active >= 0) {
            // Picking an option must not submit the form.
            event.preventDefault();
            pick(shown[active]);
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          setOpen(false);
          setActive(-1);
        }}
      />
      {/* The list stays in the DOM so aria-controls always points at an element. */}
      <ul
        id={listId}
        onMouseDown={(event) => event.preventDefault()}
        role="listbox"
        aria-label={listLabel}
        hidden={!expanded}
        data-slot="combobox-list"
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {expanded &&
          filtered.map((group, g) =>
            group.label ? (
              <li key={`group-${g}`} role="presentation">
                <div id={`${listId}-group-${g}`} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
                <ul role="group" aria-labelledby={`${listId}-group-${g}`}>
                  {group.options.map(renderOption)}
                </ul>
              </li>
            ) : (
              group.options.map(renderOption)
            ),
          )}
      </ul>
      <p role="status" data-slot="combobox-empty" className={cn('absolute inset-x-0 top-full z-50 mt-1 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md', !empty && 'sr-only')}>
        {empty ? emptyMessage : null}
      </p>
    </div>
  );
}

export { Combobox };
