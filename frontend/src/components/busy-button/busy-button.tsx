// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/busy-button/
import type * as React from 'react';

import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';

// A Button for an action that takes a moment, such as a save (#10). While `busy` it shows a Spinner and ignores
// clicks, but it uses `aria-disabled` instead of `disabled`, so it keeps keyboard focus and screen readers still find
// it. Pair it with useBusy() to run one request at a time.
function BusyButton({
  busy = false,
  busyLabel = 'Working',
  children,
  onClick,
  ...props
}: React.ComponentProps<typeof Button> & {
  busy?: boolean;
  /** Spoken name of the Spinner while busy. */
  busyLabel?: string;
}) {
  return (
    <Button
      {...props}
      aria-disabled={busy || props['aria-disabled'] || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {busy && <Spinner size="sm" label={busyLabel} />}
      {children}
    </Button>
  );
}

export { BusyButton };
