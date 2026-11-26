// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './sheet';

test('a sheet opens from its side, is named, and Escape closes it', async () => {
  render(
    <Sheet>
      <SheetTrigger>Filter</SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Filter</SheetTitle>
          <SheetDescription>Choose a period and type.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>,
  );
  const trigger = screen.getByRole('button', { name: 'Filter' });
  fireEvent.click(trigger);
  const sheet = screen.getByRole('dialog', { name: 'Filter' });
  expect(sheet).toHaveClass('left-0', 'border-r');
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('the close button is offset by the top inset on every side except the bottom (#686)', () => {
  const insetTop = 'top-[calc(env(safe-area-inset-top)+0.75rem)]';
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const { unmount } = render(
      <Sheet defaultOpen>
        <SheetContent side={side}>
          <SheetTitle>Panel</SheetTitle>
          <SheetDescription>Details.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    if (side === 'bottom') {
      expect(close).toHaveClass('top-3');
      expect(close).not.toHaveClass(insetTop);
    } else {
      expect(close).toHaveClass(insetTop);
      expect(close).not.toHaveClass('top-3');
    }
    unmount();
  }
});

test('the close button is 44px square on touch screens (#1103)', () => {
  render(
    <Sheet defaultOpen>
      <SheetContent side="right">
        <SheetTitle>Panel</SheetTitle>
        <SheetDescription>Details.</SheetDescription>
      </SheetContent>
    </Sheet>,
  );
  expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('size-8', 'pointer-coarse:size-11');
});
