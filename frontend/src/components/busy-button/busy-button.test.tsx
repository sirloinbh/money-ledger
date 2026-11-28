// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/busy-button/
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { BusyButton } from './busy-button';
import { useBusy } from './use-busy';

test('while busy the button keeps focus, is aria-disabled, shows a spinner and ignores clicks', () => {
  const onClick = vi.fn();
  render(
    <BusyButton busy onClick={onClick}>
      Save
    </BusyButton>,
  );
  const button = screen.getByRole('button', { name: /Save/ });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).not.toBeDisabled();
  expect(screen.getByRole('status', { name: 'Working' })).toBeInTheDocument();
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

test('when not busy it is a normal button', () => {
  const onClick = vi.fn();
  render(<BusyButton onClick={onClick}>Save</BusyButton>);
  const button = screen.getByRole('button', { name: 'Save' });
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).not.toHaveAttribute('aria-busy');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(button).toHaveAttribute('type', 'button');
});

test('a custom busy label and an explicit disabled state are kept', () => {
  render(
    <BusyButton busy busyLabel="Saving entry" disabled>
      Save
    </BusyButton>,
  );
  expect(screen.getByRole('status', { name: 'Saving entry' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
});

function Form({ task }: { task: () => Promise<void> }) {
  const { busy, run } = useBusy();
  const [done, setDone] = useState(0);
  return (
    <>
      <BusyButton
        busy={busy}
        onClick={() =>
          void run(async () => {
            await task();
            setDone((n) => n + 1);
          })
        }
      >
        Save
      </BusyButton>
      <p>{`saved ${done}`}</p>
    </>
  );
}

test('useBusy runs one task at a time, so a second click while busy does nothing', async () => {
  let finish: () => void = () => {};
  const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  render(<Form task={task} />);
  const button = screen.getByRole('button', { name: 'Save' });
  button.focus();
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: /Save/ })).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(button);
  expect(task).toHaveBeenCalledTimes(1);
  await act(() => {
    finish();
    return Promise.resolve();
  });
  expect(screen.getByText('saved 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
  expect(button).toHaveFocus();
});

test('useBusy gives focus back when the task ends and focus fell to the page', async () => {
  function Probe({ task }: { task: () => Promise<void> }) {
    const { run } = useBusy();
    return (
      <button type="button" onClick={() => void run(task)}>
        Go
      </button>
    );
  }
  const button = () => screen.getByRole('button', { name: 'Go' });
  render(
    <Probe
      task={() => {
        // The page lost focus while the task ran (for example the button was disabled).
        (document.activeElement as HTMLElement).blur();
        return Promise.resolve();
      }}
    />,
  );
  button().focus();
  await act(() => {
    fireEvent.click(button());
    return Promise.resolve();
  });
  expect(button()).toHaveFocus();
});

test('useBusy reports a failed task to the caller and is free to run again', async () => {
  let result: ReturnType<typeof useBusy> | undefined;
  function Grab() {
    result = useBusy();
    return null;
  }
  render(<Grab />);
  await act(async () => {
    await expect(result?.run(() => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
  });
  expect(result?.busy).toBe(false);
  let value: number | undefined;
  await act(async () => {
    value = await result?.run(() => 7);
  });
  expect(value).toBe(7);
});
