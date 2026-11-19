// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

// A setting that applies at once, such as auto-starting the rest timer. Use the common
// Checkbox for a value saved with a form. On touch screens an invisible ::after area makes
// the 20px-high track 44px to tap, like the common Checkbox.
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer relative inline-flex h-5 w-9 shrink-0 items-center justify-start rounded-full border border-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground',
        "pointer-coarse:min-h-5 pointer-coarse:min-w-9 pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}
