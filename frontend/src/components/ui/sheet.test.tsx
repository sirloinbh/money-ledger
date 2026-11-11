// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
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
