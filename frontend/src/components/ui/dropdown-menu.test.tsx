// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu';

function RowMenu({ onEdit }: { onEdit: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">더 보기</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onEdit}>수정</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">삭제</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

test('the keyboard opens the menu and Enter picks an item', () => {
  const onEdit = vi.fn();
  render(<RowMenu onEdit={onEdit} />);
  const trigger = screen.getByRole('button', { name: '더 보기' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: '삭제' })).toHaveAttribute('data-variant', 'destructive');
  fireEvent.click(screen.getByRole('menuitem', { name: '수정' }));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});

test('Escape closes the menu and returns focus to the button', async () => {
  render(<RowMenu onEdit={() => {}} />);
  const trigger = screen.getByRole('button', { name: '더 보기' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
});
