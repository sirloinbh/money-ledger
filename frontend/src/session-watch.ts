// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
/**
 * What the sign-in gate does when an API request answers 401 (#596, #669). A session that ends during use
 * sends the visitor to sign-in once; but if sign-in says "signed in" and the API keeps answering 401, the two
 * would redirect each other forever. So a second redirect within LOOP_WINDOW_MS is refused and `onLoop` runs
 * (the gate shows an error with a retry button instead).
 */
export const REDIRECT_KEY = 'sign-in-redirect-at';
export const LOOP_WINDOW_MS = 60_000;

export type MarkStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function createUnauthorizedHandler({
  storage,
  redirect,
  onLoop,
  now = Date.now,
}: {
  storage: MarkStorage | undefined;
  redirect: () => void;
  onLoop: () => void;
  now?: () => number;
}): () => void {
  // Parallel requests often fail together: only the first 401 counts.
  let handled = false;
  return () => {
    if (handled) return;
    handled = true;
    let previous = Number.NaN;
    try {
      previous = Number(storage?.getItem(REDIRECT_KEY));
    } catch {
      // Storage can be blocked (private mode); then a loop cannot be detected and the visitor is redirected.
    }
    if (now() - previous < LOOP_WINDOW_MS) {
      onLoop();
      return;
    }
    try {
      storage?.setItem(REDIRECT_KEY, String(now()));
    } catch {
      // See above.
    }
    redirect();
  };
}

/** Forgets the last redirect, so the retry button can start a fresh attempt. */
export function clearRedirectMark(storage: MarkStorage | undefined) {
  try {
    storage?.removeItem(REDIRECT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** sessionStorage, or undefined where the browser blocks it (reading the property can throw). */
export function browserStorage(): MarkStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
