// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type { ReactNode, RefObject } from 'react';

import { cn } from '../../lib/utils';

// The heading at the top of a page: an optional small eyebrow line, the page's h1, an optional description and the
// page's main actions (#689). On phones the actions move under the text; from md they sit on the right. Pass `Button`s
// from components/ui as actions. It renders a plain block, not a <header>, so it adds no second banner landmark next
// to the app shell's header. `headingRef` lets a page move focus to the h1 (for example after a deleted row), which is
// why the h1 then gets tabIndex -1. `id` is the h1's id for aria-labelledby.
function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  headingRef,
  id = 'page-title',
  className,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  id?: string;
  className?: string;
}) {
  return (
    <div data-slot="page-header" className={cn('flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-2">
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
