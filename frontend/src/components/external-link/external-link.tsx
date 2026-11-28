// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/external-link/
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { safeWebUrl } from './web-link';

// A link to another site. Only http and https addresses become links: anything else (a javascript: address, a
// relative path, text that is not a URL) renders as plain text, so a stored link can never run code. The link opens in
// a new tab, so its name ends with "(opens in a new tab)" for screen readers, and the icon is decorative.
function ExternalLink({
  href,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href' | 'target' | 'rel'> & { href: string }) {
  const safe = safeWebUrl(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a
      data-slot="external-link"
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm text-primary underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-12',
        className,
      )}
      {...props}
    >
      {children} <span className="sr-only">(opens in a new tab)</span>
      <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
    </a>
  );
}

export { ExternalLink };
