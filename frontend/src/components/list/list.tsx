// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/list/
import type * as React from 'react';

import { cn } from '../../lib/utils';

// Rows separated by a divider: each row is at least 44px tall (48px on touch) and holds text on the left and its
// actions (ListItemActions) at the end. Use it for a short list of records; a table is for several columns.
function List({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="list"
      className={cn(
        'divide-y divide-border rounded-md border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

function ListItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="list-item"
      className={cn(
        'flex min-h-11 items-center gap-3 px-4 py-2 text-body-sm pointer-coarse:min-h-12',
        className,
      )}
      {...props}
    />
  );
}

function ListItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-item-actions"
      className={cn('ml-auto flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  );
}

export { List, ListItem, ListItemActions };
