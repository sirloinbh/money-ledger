// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { expect, test } from 'vitest';

import { authOrigin } from './auth-origin';

// The shared sign-in (#551) lives at auth.<root domain>; only hosts under the root domain get it (#668).
const ROOT = 'daysofme.com';
const at = (hostname: string, protocol = 'https:') => authOrigin({ protocol, hostname }, ROOT);

test('the sign-in origin replaces the app name with auth', () => {
  expect(at('workout-memo.daysofme.com')).toBe('https://auth.daysofme.com');
  expect(at('WORKOUT-MEMO.DaysOfMe.com')).toBe('https://auth.daysofme.com');
});

test('local and IP addresses have no sign-in', () => {
  for (const hostname of ['localhost', 'app.localhost', '127.0.0.1', '3.38.114.136', '[::1]', 'api'])
    expect(at(hostname, 'http:')).toBeNull();
});

test('hosts outside the root domain never get a sign-in origin', () => {
  for (const hostname of [
    'daysofme.com',
    'myapp.pages.dev',
    'example.co.kr',
    'workout-memo.example.com',
    'evil-daysofme.com',
    'workout-memo.daysofme.com.evil.net',
    '.daysofme.com',
  ])
    expect(at(hostname)).toBeNull();
});

test('no root domain means no sign-in', () => {
  expect(authOrigin({ protocol: 'https:', hostname: 'a.daysofme.com' }, '')).toBeNull();
});
