// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
/**
 * The shared sign-in origin for this address (#551): workout-memo.daysofme.com → https://auth.daysofme.com.
 * Null on local and IP addresses, where the API runs without the sign-in.
 */
export function authOrigin({ protocol, hostname }: { protocol: string; hostname: string }) {
  const local =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('[') ||
    /^[\d.]+$/.test(hostname) ||
    !hostname.includes('.');
  return local ? null : `${protocol}//auth.${hostname.slice(hostname.indexOf('.') + 1)}`;
}
