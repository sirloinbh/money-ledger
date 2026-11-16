// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
/**
 * Wraps fetch so the first 401 from this app's own /api calls `onSignedOut` (#596). The sign-in gate
 * checks the session only when the page loads; a session that ends later (expired, signed out in
 * another tab) would otherwise leave every request failing with an error message. It watches every
 * caller of fetch, not only requestJson, because some apps still call fetch directly.
 */
export function watchSession(
  fetchFn: typeof fetch,
  pageOrigin: string,
  onSignedOut: () => void,
): typeof fetch {
  let signedOut = false;
  return async (input, init) => {
    const response = await fetchFn(input, init);
    if (response.status === 401 && !signedOut && isOwnApi(input, pageOrigin)) {
      signedOut = true;
      onSignedOut();
    }
    return response;
  };
}

function isOwnApi(input: RequestInfo | URL, pageOrigin: string) {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, pageOrigin);
  return url.origin === pageOrigin && url.pathname.startsWith('/api/');
}
