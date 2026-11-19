// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
import { afterEach, expect, test, vi } from 'vitest';

import { applyTheme, readTheme, THEME_KEY } from './theme';
import { DARK_ONLY } from './theme-config';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.className = '';
  localStorage.clear();
});

test.skipIf(DARK_ONLY)('a chosen mode sets the html class and is remembered', () => {
  applyTheme('dark');
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  expect(readTheme()).toBe('dark');
  applyTheme('light');
  expect(document.documentElement).toHaveClass('light');
  expect(document.documentElement).not.toHaveClass('dark');
});

test.skipIf(DARK_ONLY)('"system" removes the class and the saved choice', () => {
  applyTheme('dark');
  applyTheme('system');
  expect(document.documentElement.classList.length).toBe(0);
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
  expect(readTheme()).toBe('system');
});

test.skipIf(DARK_ONLY)('an unknown saved value counts as "system"', () => {
  localStorage.setItem(THEME_KEY, 'blue');
  expect(readTheme()).toBe('system');
});

// ADR-0011: features.darkOnly in the registry fixes the mode to dark.
test.runIf(DARK_ONLY)('a dark-only app reads dark whatever was saved', () => {
  localStorage.setItem(THEME_KEY, 'light');
  expect(readTheme()).toBe('dark');
  localStorage.removeItem(THEME_KEY);
  expect(readTheme()).toBe('dark');
});

// Blocked storage (private mode, site settings): reading throws, writing throws.
const blockStorage = () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
};

test.skipIf(DARK_ONLY)('blocked storage reads as "system"', () => {
  blockStorage();
  expect(readTheme()).toBe('system');
});

test.skipIf(DARK_ONLY)('blocked storage still applies the choice for this visit', () => {
  blockStorage();
  expect(() => applyTheme('dark')).not.toThrow();
  expect(document.documentElement).toHaveClass('dark');
  expect(() => applyTheme('system')).not.toThrow();
  expect(document.documentElement.classList.length).toBe(0);
});
