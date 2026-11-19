// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// The shared sign-in for the API (ADR-0015, #550, #551). Every /api request except /api/health needs a
// session from sirloinbh/shared-auth, checked over the private `shared-auth` Docker network.
//
//   const app = createApp(pool, { auth: sharedAuth() });   // server.ts
//   if (options.auth) app.use('/api', options.auth);         // app.ts, before every route
//   app.get('/api/me', meHandler);                           // app.ts, from @sirloinbh/auth-client
import { createAuthMiddleware } from '@sirloinbh/auth-client';

/**
 * The session check from AUTH_INTERNAL_URL (compose sets http://shared-auth-api:3110).
 * Unset: the API starts without a sign-in only in explicit local mode (NODE_ENV=development or test, or
 * AUTH_DISABLED=1) and logs one warning; any other value, including unset or a typo, refuses to start (#667).
 */
export function sharedAuth(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
) {
  const authUrl = env.AUTH_INTERNAL_URL;
  if (authUrl) return createAuthMiddleware({ authUrl });
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test' || env.AUTH_DISABLED === '1';
  if (!local)
    throw new Error(
      'AUTH_INTERNAL_URL is required (the shared sign-in service). For local development set NODE_ENV=development or AUTH_DISABLED=1',
    );
  warn('WARNING: AUTH_INTERNAL_URL is not set, so the API runs WITHOUT sign-in (local development only)');
  return undefined;
}
