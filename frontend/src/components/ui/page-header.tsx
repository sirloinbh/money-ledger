// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { ArrowLeft } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { Link } from 'react-router';

import { cn } from '../../lib/utils';

// The heading at the top of a page: an optional small eyebrow line, the page's h1, an optional description and the
// page's main actions (#689). On phones the actions move under the text; from md they sit on the right. Pass `Button`s
// from components/ui as actions. It renders a plain block, not a <header>, so it adds no second banner landmark next
// to the app shell's header. `headingRef` lets a page move focus to the h1 (for example after a deleted row), which is
// why the h1 then gets tabIndex -1. `id` is the h1's id for aria-labelledby. `backTo` adds a link above the title that
// goes back to the parent page ({ to, label }, for example { to: '/items', label: 'All items' }); it is a router Link,
// so the page must be inside the app's router, and it is 44px tall (48px on touch).
function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  backTo,
  headingRef,
  id = 'page-title',
  className,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  backTo?: { to: string; label: string };
  headingRef?: RefObject<HTMLHeadingElement | null>;
  id?: string;
  className?: string;
}) {
  return (
    <div data-slot="page-header" className={cn('flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {backTo ? (
          <Link
            to={backTo.to}
            data-slot="page-header-back"
            className="-ml-2 inline-flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-md px-2 text-body-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-12"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {backTo.label}
          </Link>
        ) : null}
        {eyebrow ? <p className="text-caption font-semibold tracking-widest text-muted-foreground uppercase">{eyebrow}</p> : null}
        <h1 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="break-keep">
          {title}
        </h1>
        {description ? <p className="text-body break-keep text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export { PageHeader };
