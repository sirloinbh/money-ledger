// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import swSource from '../public/sw.js?raw';
import { toast, Toaster } from './components/ui/sonner';
import { registerServiceWorker, showUpdateNotice } from './service-worker';

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

function container(controlled: boolean) {
  const target = new EventTarget();
  return {
    controller: controlled ? ({} as ServiceWorker) : null,
    addEventListener: target.addEventListener.bind(target),
    register: vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration)),
    fire: () => target.dispatchEvent(new Event('controllerchange')),
  };
}

test('a page that already had a service worker is told each time a new version takes over', () => {
  const sw = container(true);
  const onUpdate = vi.fn();
  void registerServiceWorker(onUpdate, sw);
  expect(sw.register).toHaveBeenCalledWith('/sw.js');
  sw.fire();
  expect(onUpdate).toHaveBeenCalledTimes(1);
  sw.fire();
  expect(onUpdate).toHaveBeenCalledTimes(2);
});

test('the first install is not announced, but a later deploy in the same tab is', () => {
  const sw = container(false);
  const onUpdate = vi.fn();
  void registerServiceWorker(onUpdate, sw);
  sw.fire();
  expect(onUpdate).not.toHaveBeenCalled();
  sw.fire();
  expect(onUpdate).toHaveBeenCalledTimes(1);
});

test('the new-version notice waits for the user and reloads only from its button', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...location, reload });
  render(<Toaster />);
  act(() => showUpdateNotice());
  expect(await screen.findByText('A new version is available')).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
  // A plain click: sonner's swipe handler needs setPointerCapture, which jsdom lacks.
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(reload).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

// public/sw.js is centrally managed; this guards the app's own rule that API answers (sign-in in
// #303, saved records) always come from the server and never from a cache.
test('the service worker leaves /api/ requests to the network and never caches them', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: 'https://form.example' },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
  };
  const caches = { match: vi.fn(() => Promise.resolve(undefined)), open: vi.fn() };
  const fetch = vi.fn(() => Promise.resolve({ ok: false }));
  new Function('self', 'caches', 'fetch', swSource)(self, caches, fetch);
  const handled = (path: string, mode = 'cors', method = 'GET') => {
    const respondWith = vi.fn();
    listeners.get('fetch')!({
      request: { url: 'https://form.example' + path, mode, method },
      respondWith,
    });
    return respondWith.mock.calls.length > 0;
  };
  expect(handled('/api/workouts?from=2026-11-01&to=2026-11-30')).toBe(false);
  expect(handled('/api/auth/session')).toBe(false);
  expect(handled('/api/workouts', 'cors', 'POST')).toBe(false);
  expect(handled('/api/export', 'navigate')).toBe(false);
  expect(caches.match).not.toHaveBeenCalled();
  expect(caches.open).not.toHaveBeenCalled();
  // Pages fall back to offline.html and hashed build files are cached, as docs/mobile-app.md says.
  expect(handled('/journal', 'navigate')).toBe(true);
  expect(handled('/assets/index-abc123.js')).toBe(true);
});
