// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';

function Confirm() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>삭제</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>기록을 삭제할까요?</DialogTitle>
          <DialogDescription>삭제하면 되돌릴 수 없습니다.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">취소</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

test('the trigger opens a named modal dialog with focus inside', () => {
  render(<Confirm />);
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  const dialog = screen.getByRole('dialog', { name: '기록을 삭제할까요?' });
  expect(dialog).toHaveAccessibleDescription('삭제하면 되돌릴 수 없습니다.');
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

test('Escape closes the dialog and returns focus to the trigger', async () => {
  render(<Confirm />);
  const trigger = screen.getByRole('button', { name: '삭제' });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('the close button and a DialogClose button both close it', () => {
  render(<Confirm />);
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
