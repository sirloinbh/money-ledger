// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import type * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '../../lib/utils';

// A bottom panel that can be dragged down to close (vaul). Use it on phones for short choices and forms;
// Escape and the close button work as in Dialog.

// vaul leaves focus on the trigger by default (autoFocus=false), so keyboard users would tab outside the open
// drawer. Moving focus inside keeps it consistent with Dialog and Sheet.
function Drawer({ autoFocus = true, ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  // eslint-disable-next-line jsx-a11y-x/no-autofocus -- focus moves into the opened drawer, not on page load.
  return <DrawerPrimitive.Root data-slot="drawer" autoFocus={autoFocus} {...props} />;
}

function DrawerTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerPrimitive.Overlay
        data-slot="drawer-overlay"
        className="fixed inset-0 z-[var(--z-drawer)] bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'group/drawer-content fixed inset-x-0 bottom-0 z-[var(--z-drawer)] mt-24 flex max-h-[80dvh] flex-col rounded-t-lg border-t bg-background pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="drawer-header" className={cn('flex flex-col gap-1.5 p-4 text-center sm:text-left', className)} {...props} />;
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="drawer-footer" className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn('font-semibold text-foreground', className)} {...props} />;
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-body-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger };
