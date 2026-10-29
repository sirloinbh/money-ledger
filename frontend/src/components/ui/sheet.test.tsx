// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './sheet';

test('a sheet opens from its side, is named, and Escape closes it', async () => {
  render(
    <Sheet>
      <SheetTrigger>필터</SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>필터</SheetTitle>
          <SheetDescription>기간과 종류를 고릅니다.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>,
  );
  const trigger = screen.getByRole('button', { name: '필터' });
  fireEvent.click(trigger);
  const sheet = screen.getByRole('dialog', { name: '필터' });
  expect(sheet).toHaveClass('left-0', 'border-r');
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
});
