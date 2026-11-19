// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/utils';

// #223: a failure or warning that needs attention, in a tinted box with an optional action
// such as "Reconnect". Screen readers announce it at once (role="alert"). components/ui has no
// Alert yet; for a plain progress or success line use Notice from components/ui/notice instead.
// The text stays in the foreground colour: light-theme destructive on its own tint is about
// 4:1, under the 4.5:1 AA minimum, so only the edge and tint carry the warning colour.
export function AlertBanner({
  children,
  action,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'role'> & { action?: ReactNode }) {
  return (
    <div
      role="alert"
      data-slot="alert-banner"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-l-4 border-destructive/40 border-l-destructive bg-destructive/10 px-3.5 py-3 text-sm text-foreground',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
