// The shared screen-test setup (managed, #255): the jest-dom matchers, jsdom stand-ins (matchMedia,
// ResizeObserver), an 8-second wait for findBy* and waitFor instead of Testing Library's 1 second, and a clean
// slate after each test (cleanup, real timers, globals, mocks, localStorage, the html class, the URL).
// Add below only what is specific to this app.
import './standard-setup';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { forgetQueryClient } from './query';

// Each test starts with an empty query cache (#213). The screens unmount first (this hook runs before the shared
// one), so no query still on the screen reads again from a cache that was just emptied.
afterEach(() => {
  cleanup();
  forgetQueryClient();
});
