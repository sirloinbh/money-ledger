import type { RefObject } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { kindLabel } from './entry-filters-state';
import { type Entry, entryLabel, pageSize, paymentMethodLabel } from './entry-model';
import { formatWon } from './format';
import { cn } from './lib/utils';

// #190 The entry list with its pages, its load failure, and each row's edit and delete.

export function EntryList({
  entries,
  loading,
  total,
  failed,
  onRetry,
  page,
  onPage,
  onEdit,
  onDelete,
  returnFocusRef,
  onDeleteOpen,
}: {
  entries: Entry[] | undefined;
  /** The list shown is for the previous filters while the new one loads. */
  loading: boolean;
  total: number;
  failed: boolean;
  onRetry: () => void;
  page: number;
  onPage: (page: number) => void;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => Promise<void>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onDeleteOpen: () => void;
}) {
  // Shown above the previous list, which stays with its page buttons so focus is not lost.
  const failure = failed ? (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-body-sm text-muted-foreground">Could not load the entries.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  ) : null;
  if (entries === undefined) {
    if (failure) return failure;
    return <p className="text-body-sm text-muted-foreground">Loading entries</p>;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // aria-disabled, not disabled: a button that becomes unavailable on the last page keeps the focus.
  const pageButton = (label: string, target: number, available: boolean) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={!available || undefined}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onClick={() => {
        if (available) onPage(target);
      }}
    >
      {label}
    </Button>
  );
  const pager =
    pages > 1 || page > 1 ? (
      <nav aria-label="Entry pages" className="flex items-center justify-center gap-3">
        {pageButton('Previous page', Math.min(page - 1, pages), page > 1)}
        <span className="text-body-sm tabular-nums">
          Page {page} of {pages}
        </span>
        {pageButton('Next page', page + 1, page < pages)}
      </nav>
    ) : null;
  // After a failed load the previous list is not "loading" any more: the failure says what happened.
  const pending = loading && !failed;
  const status = failed ? null : (
    <p className="text-body-sm text-muted-foreground">
      {loading ? 'Loading…' : `${total} ${total === 1 ? 'entry' : 'entries'}`}
    </p>
  );
  if (entries.length === 0) {
    return (
      <div aria-busy={pending || undefined} className="flex flex-col gap-3">
        {failure}
        {pending ? status : null}
        <p className="text-body-sm text-muted-foreground">
          {total > 0 ? 'There are no entries on this page.' : 'No entries match the filters.'}
        </p>
        {pager}
      </div>
    );
  }
  return (
    <div aria-busy={pending || undefined} className="flex flex-col gap-3">
      {failure}
      {status}
      <ul
        aria-label="Entry list"
        className={cn('flex flex-col divide-y rounded-xl border', loading && 'opacity-60')}
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
                {entry.date}
                <Badge variant={entry.kind === 'income' ? 'success' : 'secondary'}>
                  {kindLabel[entry.kind]}
                </Badge>
                {entry.splits?.length ? 'Split' : (entry.categoryName ?? 'Uncategorized')}
                {entry.paymentMethod ? ` · ${paymentMethodLabel[entry.paymentMethod]}` : ''}
              </span>
              {entry.splits?.length ? (
                <span className="text-body-sm text-muted-foreground">
                  {entry.splits
                    .map((part) => `${part.categoryName} ${formatWon(part.amount)}`)
                    .join(' · ')}
                </span>
              ) : null}
              {entry.merchant || entry.memo ? (
                <span className="break-words">
                  {[entry.merchant, entry.memo].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium tabular-nums">
                {entry.kind === 'income' ? '+' : '-'}
                {formatWon(entry.amount)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Edit ${entryLabel(entry)}`}
                onClick={() => onEdit(entry)}
              >
                Edit
              </Button>
              <ConfirmDialog
                title="Delete this entry?"
                description={`${entryLabel(entry)}. Deleting it cannot be undone.`}
                onConfirm={() => onDelete(entry)}
                returnFocusRef={returnFocusRef}
                onOpenChange={(open) => {
                  if (open) onDeleteOpen();
                }}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${entryLabel(entry)}`}
                  >
                    Delete
                  </Button>
                }
              />
            </div>
          </li>
        ))}
      </ul>
      {pager}
    </div>
  );
}
