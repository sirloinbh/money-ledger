// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import type * as React from 'react';
import { cn } from '../../lib/utils';

// Shown when a list or page has nothing yet. Give the next step as `action` (usually a Button).
function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel: Heading = 'h2',
  className,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  headingLevel?: 'h2' | 'h3' | 'h4';
}) {
  return (
    <section
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6" aria-hidden>
          {icon}
        </div>
      ) : null}
      <Heading className="text-body font-semibold">{title}</Heading>
      {description ? <p className="max-w-sm text-body-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}

export { EmptyState };
