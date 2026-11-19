// Managed file. Edit it in sirloinbh/project-standards templates/vitest/frontend/src/test/
// What every app's screen tests need (#680): the jest-dom matchers, jsdom stand-ins for browser APIs it lacks, a
// generous wait for slow PCs, and a clean slate after each test. The app's own src/test/setup.ts starts with
// `import './standard-setup';` and adds whatever is specific to the app (for example resetting its own module state).
import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// findBy* and waitFor give up after 1 second by default. A role query over the whole page takes 50-250 ms on its own
// and several seconds when the PC is busy, so screen tests failed at random. 8 s leaves about 7 s of the usual 15 s
// testTimeout for the rest of the test, so a real failure still ends with Testing Library's message and the page.
configure({ asyncUtilTimeout: 8_000 });

// jsdom has no matchMedia; the toaster and drawer read it to follow the system theme.
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

// jsdom has no ResizeObserver; Radix switches, checkboxes and popovers measure themselves with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = '';
  // Pages are URLs; each test starts on the first page.
  window.history.replaceState(null, '', '/');
});
