// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/toggle-chips/
import { ToggleGroup } from 'radix-ui';
import type * as React from 'react';

import { cn } from '../../lib/utils';

type ToggleChipOption = { value: string; label: React.ReactNode; disabled?: boolean };

type Shared = {
  options: ToggleChipOption[];
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
};

type Single = Shared & {
  type?: 'single';
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type Multiple = Shared & {
  type: 'multiple';
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

const chip =
  'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-input bg-background px-4 text-body-sm font-medium transition-colors outline-none pointer-coarse:min-h-12 hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground';

// A row of chips that can be switched on and off. It differs from SegmentedControl, which always has exactly one
// choice: here `single` allows none (clicking the chosen chip clears it) and `multiple` allows any number. `single`
// is announced as a radio group and `multiple` as toggle buttons (aria-pressed), both with arrow key movement.
// Give the group a name with aria-label or aria-labelledby.
function ToggleChips(props: Single | Multiple) {
  const { options, className, disabled } = props;
  const items = options.map((option) => (
    <ToggleGroup.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      data-slot="toggle-chip"
      className={chip}
    >
      {option.label}
    </ToggleGroup.Item>
  ));
  const common = {
    'data-slot': 'toggle-chips',
    disabled,
    className: cn('flex flex-wrap gap-2', className),
    id: props.id,
    'aria-label': props['aria-label'],
    'aria-labelledby': props['aria-labelledby'],
  };
  if (props.type === 'multiple') {
    return (
      <ToggleGroup.Root
        type="multiple"
        value={props.value}
        defaultValue={props.defaultValue}
        onValueChange={props.onValueChange}
        {...common}
      >
        {items}
      </ToggleGroup.Root>
    );
  }
  return (
    <ToggleGroup.Root
      type="single"
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={props.onValueChange}
      {...common}
    >
      {items}
    </ToggleGroup.Root>
  );
}

export { type ToggleChipOption, ToggleChips };
