// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/responsive-modal/
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { useKeyboardInset } from '../ui/keyboard-inset';
import { ResponsiveModal } from './responsive-modal';

afterEach(() => vi.unstubAllGlobals());

test('the trigger opens a named modal with its footer, and Escape closes it', async () => {
  render(
    <ResponsiveModal
      title="Edit workout"
      description="Change the sets."
      trigger={<button>Edit</button>}
      footer={<button>Save</button>}
    >
      <label>
        Name <input />
      </label>
    </ResponsiveModal>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit workout' });
  expect(dialog).toHaveAccessibleDescription('Change the sets.');
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('below 640px it is a bottom sheet by default and a full screen with layout full', async () => {
  const { rerender } = render(<ResponsiveModal title="Sheet" open />);
  const sheet = await screen.findByRole('dialog', { name: 'Sheet' });
  expect(sheet.className).toContain('max-sm:bottom-[var(--keyboard-inset,0px)]');
  expect(sheet.className).toContain('max-sm:rounded-b-none');
  rerender(<ResponsiveModal title="Full" open layout="full" />);
  const full = await screen.findByRole('dialog', { name: 'Full' });
  expect(full.className).toContain('max-sm:inset-0');
  expect(full.className).toContain('max-sm:h-[calc(100dvh-var(--keyboard-inset,0px))]');
});

test('Dialog keeps the centered box by default', async () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Centered</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Centered' });
  expect(dialog.className).toContain('top-1/2');
  expect(dialog.className).not.toContain('max-sm:');
});

test('onOpenChange reports the close button', async () => {
  const onOpenChange = vi.fn();
  render(<ResponsiveModal title="Details" open onOpenChange={onOpenChange} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

function Probe({ active = true }: { active?: boolean }) {
  return <output data-testid="inset">{useKeyboardInset(active)}</output>;
}

test('useKeyboardInset reports how much of the bottom the keyboard covers and follows resizes', () => {
  const listeners = new Map<string, () => void>();
  const viewport = {
    height: 800,
    offsetTop: 0,
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 800);
  render(<Probe />);
  expect(screen.getByTestId('inset')).toHaveTextContent('0');
  viewport.height = 500;
  act(() => listeners.get('resize')?.());
  expect(screen.getByTestId('inset')).toHaveTextContent('300');
  viewport.height = 800;
  act(() => listeners.get('resize')?.());
  expect(screen.getByTestId('inset')).toHaveTextContent('0');
});

test('useKeyboardInset is zero without a visual viewport or when it is not active', () => {
  vi.stubGlobal('visualViewport', undefined);
  const { unmount } = render(<Probe />);
  expect(screen.getByTestId('inset')).toHaveTextContent('0');
  unmount();
  vi.stubGlobal('visualViewport', {
    height: 300,
    offsetTop: 0,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('innerHeight', 800);
  render(<Probe active={false} />);
  expect(screen.getByTestId('inset')).toHaveTextContent('0');
});
