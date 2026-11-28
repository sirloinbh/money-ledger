// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { ToggleGroup } from 'radix-ui';

import { cn } from '../../lib/utils';

export type SegmentOption<T extends string> = { value: T; label: string };

// One choice out of a few, such as period tabs. Exactly one stays selected: a click on the
// current option keeps it (Radix would otherwise clear it) and only calls onReselect.
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  onReselect,
  className,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  onReselect?: () => void;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
        else onReselect?.();
      }}
      className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-md bg-muted p-1', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="min-h-8 cursor-pointer rounded-sm px-3 text-body-sm text-foreground/70 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring data-[state=on]:bg-card data-[state=on]:font-medium data-[state=on]:text-foreground pointer-coarse:min-h-11"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
