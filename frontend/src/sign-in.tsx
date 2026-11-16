// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { createUseUser, signInUrl, signOutUrl, type User } from '@sirloinbh/auth-client';
import type * as React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

import { authOrigin } from './auth-origin';
import { Button } from './components/ui/button';
import { Spinner } from './components/ui/spinner';
import { watchSession } from './session-watch';

// The shared sign-in (sirloinbh/shared-auth, ADR-0015, #550, #551). The API answers 401
// without a session; the screen sends a signed-out visitor to auth.<domain> and back.
const useUser = createUseUser({ useState, useEffect });
const SignedInUser = createContext<User | null>(null);

/** Shows children only to a signed-in visitor; without an auth origin it shows them as before. */
export function SignInGate({ children }: { children: React.ReactNode }) {
  const origin = authOrigin(window.location);
  return origin ? <Gate origin={origin}>{children}</Gate> : children;
}

function Gate({ origin, children }: { origin: string; children: React.ReactNode }) {
  const state = useUser();
  useEffect(() => {
    if (state.status === 'signed-out')
      window.location.assign(signInUrl(origin, window.location.href));
  }, [origin, state.status]);
  // #596: once signed in, a 401 from the app's API means the session ended during use; back to sign-in.
  useEffect(() => {
    if (state.status !== 'signed-in') return;
    const original = window.fetch;
    window.fetch = watchSession(original, window.location.origin, () =>
      window.location.assign(signInUrl(origin, window.location.href)),
    );
    return () => {
      window.fetch = original;
    };
  }, [origin, state.status]);
  if (state.status === 'signed-in')
    return <SignedInUser.Provider value={state.user}>{children}</SignedInUser.Provider>;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-body-sm text-muted-foreground">
      {state.status === 'error' ? (
        <div role="alert" className="flex flex-col items-center gap-3">
          <p>Could not check your sign-in.</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
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

/** The signed-in account and a sign-out link for the top bar; nothing when there is no sign-in. */
export function AccountActions() {
  const user = useContext(SignedInUser);
  const origin = authOrigin(window.location);
  if (!user || !origin) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-48 truncate text-body-sm text-muted-foreground sm:inline">
        {user.name ?? user.email}
      </span>
      <Button asChild variant="ghost" size="sm">
        <a href={signOutUrl(origin, window.location.origin)}>Sign out</a>
      </Button>
    </div>
  );
}
