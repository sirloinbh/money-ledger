// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/confirm-delete/
import type * as React from 'react';
import { useRef } from 'react';

import { ConfirmDialog } from '../ui/confirm-dialog';

// Asks before an item is deleted. Keep the item the user chose in state: `item` is that item (or null when nothing is
// being deleted) and the dialog is open while it is set. `label` says which item in the title ("Delete Bench press?").
// `onConfirm` receives the item; the dialog closes when it resolves and stays open when it rejects, so the screen can
// show the error (see ConfirmDialog). `onClose` is called for Cancel, Escape and after a successful delete: clear the
// state there. Pass `returnFocusRef` to say where focus goes afterwards, for example the list's heading.
function ConfirmDelete<T>({
  item,
  label,
  onConfirm,
  onClose,
  description = 'This cannot be undone.',
  confirmLabel = 'Delete',
  returnFocusRef,
}: {
  item: T | null;
  label: (item: T) => string;
  onConfirm: (item: T) => void | Promise<unknown>;
  onClose: () => void;
  description?: React.ReactNode;
  confirmLabel?: string;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  // While the dialog fades out the item is already cleared, so keep the last one for the title.
  const last = useRef<T | null>(null);
  if (item !== null) last.current = item;
  const shown = item ?? last.current;
  return (
    <ConfirmDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={shown === null ? 'Delete?' : `Delete ${label(shown)}?`}
      description={description}
      confirmLabel={confirmLabel}
      returnFocusRef={returnFocusRef}
      onConfirm={() => (item === null ? undefined : onConfirm(item))}
    />
  );
}

export { ConfirmDelete };
