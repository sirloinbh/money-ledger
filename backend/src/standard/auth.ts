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
 * Unset: undefined, so local development runs without the sign-in. Production refuses to start without it.
 */
export function sharedAuth(env: Record<string, string | undefined> = process.env) {
  const authUrl = env.AUTH_INTERNAL_URL;
  if (!authUrl && env.NODE_ENV === 'production')
    throw new Error('AUTH_INTERNAL_URL is required in production (the shared sign-in service)');
  return authUrl ? createAuthMiddleware({ authUrl }) : undefined;
}
