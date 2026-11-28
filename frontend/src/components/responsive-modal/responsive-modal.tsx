// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/responsive-modal/
import type * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';

// A modal for forms and details that adapts to the screen: from 640px up it is the centered dialog, and below that it
// is a sheet stuck to the bottom edge (`layout="sheet"`, the default) or a full screen (`layout="full"`). Either way it
// stays above the on-screen keyboard, so the field being typed in is never hidden. It is the shared Dialog underneath:
// focus stays inside while open, Escape and the close button close it, and the title names it. Put the actions in
// `footer`. Control it with `open` and `onOpenChange`, or pass a `trigger` button.
function ResponsiveModal({
  title,
  description,
  children,
  footer,
  layout = 'sheet',
  trigger,
  open,
  onOpenChange,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  layout?: 'sheet' | 'full';
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        layout={layout}
        className={className}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

export { ResponsiveModal };
