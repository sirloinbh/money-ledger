// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2Icon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/utils';

// Spinner for short waits and buttons that are saving. Three sizes only (docs/design-system.md).
const spinnerVariants = cva('animate-spin motion-reduce:animate-none', {
  variants: { size: { sm: 'size-4', md: 'size-6', lg: 'size-8' } },
  defaultVariants: { size: 'md' },
});

function Spinner({
  className,
  size,
  label = '불러오는 중',
  ...props
}: Omit<React.ComponentProps<'svg'>, 'children'> & VariantProps<typeof spinnerVariants> & { label?: string }) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={label}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- shadcn/ui exports the variants next to the component.
export { Spinner, spinnerVariants };
