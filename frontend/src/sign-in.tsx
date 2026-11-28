// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { createUseUser, signInUrl, signOutUrl, type User } from '@sirloinbh/auth-client';
import { LogOutIcon } from 'lucide-react';
import type * as React from 'react';
import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';

import { authOrigin } from './auth-origin';
import { Button } from './components/ui/button';
import { Spinner } from './components/ui/spinner';
import { onUnauthorized } from './lib/api';
import { ROOT_DOMAIN } from './lib/auth-config';
import { browserStorage, clearRedirectMark, createUnauthorizedHandler } from './session-watch';

// The shared sign-in (sirloinbh/shared-auth, ADR-0015, #550, #551). The API answers 401
// without a session; the screen sends a signed-out visitor to auth.<domain> and back.
const useUser = createUseUser({ useState, useEffect });
const SignedInUser = createContext<User | null>(null);

/** Shows children only to a signed-in visitor; without an auth origin it shows them as before. */
export function SignInGate({ children }: { children: React.ReactNode }) {
  const origin = authOrigin(window.location, ROOT_DOMAIN);
  return origin ? <Gate origin={origin}>{children}</Gate> : children;
}

function Gate({ origin, children }: { origin: string; children: React.ReactNode }) {
  const state = useUser();
  useEffect(() => {
    if (state.status === 'signed-out')
      window.location.assign(signInUrl(origin, window.location.href));
  }, [origin, state.status]);
  // #596, #669: a 401 from the app's API means the session ended; back to sign-in once. A layout effect runs
  // before the children's first effects, so even their first requests are watched. If sign-in keeps sending the
  // visitor back to a 401 (a redirect loop), the gate shows an error with a retry button instead.
  const [loop, setLoop] = useState(false);
  useLayoutEffect(() => {
    if (state.status !== 'signed-in') return;
    return onUnauthorized(
      createUnauthorizedHandler({
        storage: browserStorage(),
        redirect: () => window.location.assign(signInUrl(origin, window.location.href)),
        onLoop: () => setLoop(true),
      }),
    );
  }, [origin, state.status]);
  const failed = loop || state.status === 'error';
  if (state.status === 'signed-in' && !loop)
    return <SignedInUser.Provider value={state.user}>{children}</SignedInUser.Provider>;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-body-sm text-muted-foreground">
      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3">
          <p>{loop ? 'Signing in did not finish.' : 'Could not check your sign-in.'}</p>
          <Button
            variant="outline"
            onClick={() => {
              clearRedirectMark(browserStorage());
              window.location.reload();
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        // The shared Spinner beside the status line while the session is checked (workout-memo#317).
        <div aria-busy="true" aria-label="Sign-in check" className="flex items-center gap-2">
          <Spinner size="sm" aria-hidden />
          <p role="status">Checking your sign-in…</p>
        </div>
      )}
    </main>
  );
}

/** The signed-in account and a sign-out icon link for the top bar; nothing when there is no sign-in. */
export function AccountActions() {
  const user = useContext(SignedInUser);
  const origin = authOrigin(window.location, ROOT_DOMAIN);
  if (!user || !origin) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-48 truncate text-body-sm text-muted-foreground sm:inline">
        {user.name ?? user.email}
      </span>
      <Button asChild variant="ghost" size="icon">
        <a href={signOutUrl(origin, window.location.origin)} aria-label="Sign out" title="Sign out">
          <LogOutIcon aria-hidden />
        </a>
      </Button>
    </div>
  );
}
