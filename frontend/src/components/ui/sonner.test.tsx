// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, test } from 'vitest';

import { toast, Toaster } from './sonner';

// jsdom has no matchMedia; sonner reads it to follow the system theme.
beforeAll(() => {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  document.documentElement.className = '';
  act(() => {
    toast.dismiss();
  });
});

test('a toast message appears in the notification region', async () => {
  render(<Toaster />);
  act(() => {
    toast.success('Saved');
  });
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: /Notifications/ })).toBeInTheDocument();
});

test('the toaster follows the html light/dark class', async () => {
  document.documentElement.classList.add('dark');
  render(<Toaster />);
  act(() => {
    toast('Confirm');
  });
  await screen.findByText('Confirm');
  expect(document.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark');
});

test('the toaster follows a change of the html class after it is mounted', async () => {
  render(<Toaster />);
  act(() => {
    toast('Confirm');
  });
  await screen.findByText('Confirm');
  const toaster = () => document.querySelector('[data-sonner-toaster]');
  expect(toaster()).toHaveAttribute('data-sonner-theme', 'light'); // jsdom: the system setting is light
  act(() => {
    document.documentElement.classList.add('dark');
  });
  await waitFor(() => expect(toaster()).toHaveAttribute('data-sonner-theme', 'dark'));
  act(() => {
    document.documentElement.classList.replace('dark', 'light');
  });
  await waitFor(() => expect(toaster()).toHaveAttribute('data-sonner-theme', 'light'));
});
