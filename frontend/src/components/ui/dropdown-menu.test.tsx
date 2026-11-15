// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu';

function RowMenu({ onEdit }: { onEdit: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">More</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

test('the keyboard opens the menu and Enter picks an item', () => {
  const onEdit = vi.fn();
  render(<RowMenu onEdit={onEdit} />);
  const trigger = screen.getByRole('button', { name: 'More' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-variant', 'destructive');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});

test('Escape closes the menu and returns focus to the button', async () => {
  render(<RowMenu onEdit={() => {}} />);
  const trigger = screen.getByRole('button', { name: 'More' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
});
