import { getConfig } from '@testing-library/react';
import { expect, test } from 'vitest';

// #255 The app's setup must load the managed standard-setup.ts. Without it, findBy* and waitFor give up after
// Testing Library's default 1 second and screen tests fail at random on a busy PC.
test('screen tests run with the shared setup: an 8-second wait and the jsdom stand-ins', () => {
  expect(getConfig().asyncUtilTimeout).toBe(8_000);
  expect(typeof globalThis.ResizeObserver).toBe('function');
  expect(typeof window.matchMedia).toBe('function');
});
