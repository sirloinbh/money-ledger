// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/disclosure/
import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/utils';

// A native <details>: the browser handles open and close, the keyboard (Enter and Space on the summary) and the
// screen reader state, so there is no extra package. The summary is at least 44px tall on a pointer screen and 48px on
// touch, and the chevron turns when the block is open. `open` starts it open; `onOpenChange` reports every change.
function Disclosure({
  summary,
  children,
  className,
  summaryClassName,
  onToggle,
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<'details'>, 'summary'> & {
  summary: React.ReactNode;
  summaryClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <details
      data-slot="disclosure"
      className={cn(
        'group rounded-md border border-border bg-card text-card-foreground',
        className,
      )}
      onToggle={(event) => {
        onToggle?.(event);
        onOpenChange?.(event.currentTarget.open);
      }}
      {...props}
    >
      <summary
        data-slot="disclosure-summary"
        className={cn(
          'flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-4 py-2 text-body-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-12 [&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        <span className="min-w-0 break-keep">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div data-slot="disclosure-content" className="px-4 pt-1 pb-4 text-body-sm">
        {children}
      </div>
    </details>
  );
}

export { Disclosure };
