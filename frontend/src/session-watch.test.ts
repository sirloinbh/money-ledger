// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { expect, test, vi } from 'vitest';

import { watchSession } from './session-watch';

// #596: a session that ends while a page is open sends the visitor to sign-in on the first 401.
const page = 'https://study-log.daysofme.com';
const answering = (status: number) => vi.fn(() => Promise.resolve(new Response(null, { status })));

test('the first 401 from the app API signs out once and still returns the response', async () => {
  const onSignedOut = vi.fn();
  const watched = watchSession(answering(401), page, onSignedOut);
  expect((await watched('/api/logs')).status).toBe(401);
  await watched(new URL('/api/logs/2', page), { method: 'DELETE' });
  await watched(new Request(`${page}/api/stats`));
  expect(onSignedOut).toHaveBeenCalledOnce();
});

test('other statuses, other paths and other origins are left alone', async () => {
  const onSignedOut = vi.fn();
  await watchSession(answering(200), page, onSignedOut)('/api/logs');
  await watchSession(answering(403), page, onSignedOut)('/api/logs');
  await watchSession(answering(401), page, onSignedOut)('/apiary');
  await watchSession(answering(401), page, onSignedOut)('https://auth.daysofme.com/api/x');
  expect(onSignedOut).not.toHaveBeenCalled();
});
