// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { expect, test } from 'vitest';

import { authOrigin } from './auth-origin';

// The shared sign-in (#551) lives at auth.<domain>; local and IP addresses run without it.
test('the sign-in origin replaces the app name with auth', () => {
  expect(authOrigin({ protocol: 'https:', hostname: 'workout-memo.daysofme.com' })).toBe(
    'https://auth.daysofme.com',
  );
});

test('local and IP addresses have no sign-in', () => {
  for (const hostname of [
    'localhost',
    'app.localhost',
    '127.0.0.1',
    '3.38.114.136',
    '[::1]',
    'api',
  ])
    expect(authOrigin({ protocol: 'http:', hostname })).toBeNull();
});
