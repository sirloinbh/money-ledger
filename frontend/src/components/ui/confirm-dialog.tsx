// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import * as React from 'react';

import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { Spinner } from './spinner';

// Asks before a destructive action such as delete (#311), instead of the browser's confirm().
// Either pass `trigger` (the button that opens it) or control it with `open` and `onOpenChange`.
// While `onConfirm` runs the buttons are disabled; the dialog closes when it resolves and stays open when it
// rejects, so the screen can show the error (for example with useNotice).

type ConfirmDialogProps = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions (the default) get the destructive button style. */
  destructive?: boolean;
  onConfirm: () => void | Promise<unknown>;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function ConfirmDialog({
  title,
  description,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  destructive = true,
  onConfirm,
  trigger,
  open: openProp,
  onOpenChange,
}: ConfirmDialogProps) {
  const [openState, setOpenState] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const confirm = () => {
    const result = onConfirm();
    if (!(result instanceof Promise)) {
      setOpen(false);
      return;
    }
    setPending(true);
    result.then(
      () => {
        setPending(false);
        setOpen(false);
      },
      () => setPending(false),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
            {pending ? <Spinner size="sm" label="처리하는 중" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
export type { ConfirmDialogProps };
