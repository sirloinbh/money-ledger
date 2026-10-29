// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import type * as React from 'react';

import type { NoticeValue } from '../../lib/use-notice';
import { cn } from '../../lib/utils';

// A message inside the screen, next to what it is about (#311). Screen readers announce it:
// "status" politely (role="status"), "error" at once (role="alert"). For a passing message that is not
// tied to one place, use the toast from sonner instead.

function Notice({ notice, className, ...props }: Omit<React.ComponentProps<'p'>, 'children' | 'role'> & { notice: NoticeValue | undefined }) {
  if (!notice) return null;
  return (
    <p
      data-slot="notice"
      data-kind={notice.kind}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn('text-body-sm', notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground', className)}
      {...props}
    >
      {notice.text}
    </p>
  );
}

export { Notice };
