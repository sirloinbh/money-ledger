// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/table/
import type * as React from 'react';

import { cn } from '../../lib/utils';

// A plain data table (#8). One look for every app: a wrapper that scrolls sideways on a narrow screen (so the page
// never overflows at 360px), `tabular-nums` for numbers, 12px or larger text, and a caption that names the table.
// The scroll wrapper is a labelled, focusable region so the keyboard can scroll it. A table with a few columns of text
// is better as a List; use a table when the columns are compared.

function Table({
  label,
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<'table'> & {
  /** Names the scrollable region (usually the same text as the caption). */
  label: string;
  wrapperClassName?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
      tabIndex={0}
      data-slot="table-wrapper"
      className={cn(
        'relative w-full overflow-x-auto rounded-md border border-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        wrapperClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-top border-collapse text-body-sm', className)}
        {...props}
      />
    </div>
  );
}

/** The table's name. Keep it visible; use `className="sr-only"` only when a heading already names the table. */
function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('px-3 py-2 text-left font-medium', className)}
      {...props}
    />
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('border-b border-border bg-muted', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody data-slot="table-body" className={cn('divide-y divide-border', className)} {...props} />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('align-middle', className)} {...props} />;
}

type CellProps = {
  /** Right-aligned digits that line up (`tabular-nums`). */
  numeric?: boolean;
  /** Keeps the cell in place while the table scrolls sideways (the first column). */
  sticky?: boolean;
};

const cellClasses = ({ numeric, sticky }: CellProps) =>
  cn(
    'px-3 py-2',
    numeric ? 'text-right tabular-nums' : 'text-left',
    sticky && 'sticky left-0 bg-card [thead_&]:bg-muted',
  );

/** A column or row header. `scope` is "col" by default; pass `scope="row"` for the first cell of a row. */
function TableHead({
  numeric,
  sticky,
  scope = 'col',
  className,
  ...props
}: React.ComponentProps<'th'> & CellProps) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(cellClasses({ numeric, sticky }), 'font-medium', className)}
      {...props}
    />
  );
}

function TableCell({
  numeric,
  sticky,
  className,
  ...props
}: React.ComponentProps<'td'> & CellProps) {
  return (
    <td
      data-slot="table-cell"
      className={cn(cellClasses({ numeric, sticky }), className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow };
