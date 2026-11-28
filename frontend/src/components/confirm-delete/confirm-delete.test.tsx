// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/confirm-delete/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { ConfirmDelete } from './confirm-delete';

type Workout = { id: number; name: string };
const bench: Workout = { id: 1, name: 'Bench press' };

function Screen({ onConfirm }: { onConfirm: (item: Workout) => void | Promise<unknown> }) {
  const [item, setItem] = useState<Workout | null>(null);
  return (
    <>
      <button onClick={() => setItem(bench)}>Delete bench</button>
      <ConfirmDelete
        item={item}
        label={(w) => w.name}
        onConfirm={onConfirm}
        onClose={() => setItem(null)}
      />
    </>
  );
}

test('it is closed until an item is chosen, then names the item', async () => {
  render(<Screen onConfirm={() => {}} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete bench' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete Bench press?' });
  expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
});

test('confirming deletes the chosen item and closes', async () => {
  const onConfirm = vi.fn(() => Promise.resolve());
  render(<Screen onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete bench' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(bench));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('cancel closes without deleting', async () => {
  const onConfirm = vi.fn();
  render(<Screen onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete bench' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onConfirm).not.toHaveBeenCalled();
});

test('a failed delete keeps the dialog open so the screen can show the error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<Screen onConfirm={() => Promise.reject(new Error('Server error'))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete bench' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(console.error).toHaveBeenCalled());
  expect(screen.getByRole('dialog', { name: 'Delete Bench press?' })).toBeInTheDocument();
});

test('the labels can be changed', async () => {
  render(
    <ConfirmDelete
      item={bench}
      label={(w) => w.name}
      onConfirm={() => {}}
      onClose={() => {}}
      description="The sets go too."
      confirmLabel="Remove"
    />,
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAccessibleDescription('The sets go too.');
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
});
