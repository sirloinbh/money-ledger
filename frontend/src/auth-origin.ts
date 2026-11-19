// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
/**
 * The shared sign-in origin for this address (#551): workout-memo.daysofme.com → https://auth.daysofme.com.
 * Only hosts under the registry's root domain get one (#668), so a return URL is never sent to a foreign
 * site (`app.pages.dev`, `example.co.kr`). Null on local, IP, apex and foreign addresses, where the API runs
 * without the sign-in. `rootDomain` is ROOT_DOMAIN from lib/auth-config.ts (rendered per app).
 */
export function authOrigin(
  { protocol, hostname }: { protocol: string; hostname: string },
  rootDomain: string,
) {
  const host = hostname.toLowerCase();
  const root = rootDomain.toLowerCase();
  if (!root || !host.endsWith(`.${root}`)) return null;
  // The prefix must be real labels: not an IP, not empty, not "auth" itself.
  const prefix = host.slice(0, -(root.length + 1));
  if (!prefix || prefix.startsWith('.') || prefix.endsWith('.')) return null;
  return `${protocol}//auth.${root}`;
}
