// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type * as React from 'react';

import type { NoticeValue } from '../../lib/use-notice';
import { cn } from '../../lib/utils';

// A message inside the screen, next to what it is about (#311). Screen readers announce it:
// "status" politely (role="status"), "error" at once (role="alert"). Its live regions are always in the page,
// empty until there is a message, so the first message is announced too (#684). For a passing message that is not
// tied to one place, use the toast from sonner instead.

function Notice({ notice, className, ...props }: Omit<React.ComponentProps<'div'>, 'children' | 'role'> & { notice: NoticeValue | undefined }) {
  // Both live regions stay mounted and only their text changes: a region that is inserted together with its
  // text is not announced by many screen readers (#684). Only the one for the current kind has text.
  return (
    <div
      data-slot="notice"
      data-kind={notice?.kind}
      className={cn('text-body-sm', notice?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground', className)}
      {...props}
    >
      <p role="status">{notice?.kind === 'status' ? notice.text : null}</p>
      <p role="alert">{notice?.kind === 'error' ? notice.text : null}</p>
    </div>
  );
}

export { Notice };
