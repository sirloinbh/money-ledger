// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { expect, test, vi } from 'vitest';

import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';

function deferred() {
  let resolve = () => {};
  let reject = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = () => rej(new Error('Could not delete'));
  });
  return { promise, resolve, reject };
}

test('the trigger opens a named dialog; confirming runs the action and closes it', () => {
  const onConfirm = vi.fn();
  render(<ConfirmDialog title="Delete this entry?" description="This cannot be undone." onConfirm={onConfirm} trigger={<Button>Delete item</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete this entry?' });
  expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('data-slot', 'button');
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('cancel closes without running the action', () => {
  const onConfirm = vi.fn();
  render(<ConfirmDialog title="Delete this goal?" onConfirm={onConfirm} trigger={<Button>Delete item</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('while the action runs the buttons wait; the dialog closes when it succeeds', async () => {
  const work = deferred();
  render(<ConfirmDialog title="Delete it?" onConfirm={() => work.promise} trigger={<Button>Open</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
  expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('status', { name: 'Working' })).toBeInTheDocument();
  work.resolve();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('a failed action leaves the dialog open so the screen can show why', async () => {
  const work = deferred();
  render(<ConfirmDialog title="Delete it?" onConfirm={() => work.promise} trigger={<Button>Open</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
  work.reject();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('it can be controlled, e.g. opened for the row the user picked', () => {
  function Rows() {
    const [target, setTarget] = React.useState<string | null>(null);
    return (
      <>
        <Button onClick={() => setTarget('Mar 2')}>Delete Mar 2</Button>
        <ConfirmDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)} title={`Delete the ${target ?? ''} entry?`} confirmLabel="Remove" destructive={false} onConfirm={() => setTarget(null)} />
      </>
    );
  }
  render(<Rows />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Mar 2' }));
  expect(screen.getByRole('dialog', { name: 'Delete the Mar 2 entry?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

function ControlledWithReturn() {
  const [open, setOpen] = React.useState(false);
  const opener = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={opener} onClick={() => setOpen(true)}>
        Change status
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="Change it?" onConfirm={() => setOpen(false)} returnFocusRef={opener} />
    </>
  );
}

test('without a trigger, closing returns focus to returnFocusRef (#356)', async () => {
  render(<ControlledWithReturn />);
  fireEvent.click(screen.getByRole('button', { name: 'Change status' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Change status' })).toHaveFocus());
});

test('with a trigger, closing still returns focus to the trigger', async () => {
  render(<ConfirmDialog title="Delete it?" onConfirm={vi.fn()} trigger={<Button>Open</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
});

test('an empty returnFocusRef keeps the trigger behaviour', async () => {
  const empty = React.createRef<HTMLElement>();
  render(<ConfirmDialog title="Delete it?" onConfirm={vi.fn()} trigger={<Button>Open</Button>} returnFocusRef={empty} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
});
