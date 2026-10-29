// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import type * as React from 'react';

import { cn } from '../../lib/utils';

// Loading placeholders in the shape of the real content (docs/design-system.md "로딩 표시").
// The pulse is hidden from screen readers; wrap a loading region in aria-busy and give it a label.

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-accent motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

/** Lines of text; the last line is shorter like a real paragraph. */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div data-slot="skeleton-text" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

/** A card with a title line and a short paragraph. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div data-slot="skeleton-card" className={cn('flex flex-col gap-4 rounded-xl border p-6', className)}>
      <Skeleton className="h-5 w-2/5" />
      <SkeletonText lines={2} />
    </div>
  );
}

/** List rows with a leading avatar or icon. */
function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div data-slot="skeleton-list" className={cn('flex flex-col gap-4', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export { Skeleton, SkeletonCard, SkeletonList, SkeletonText };
