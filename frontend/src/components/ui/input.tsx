// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { fieldClasses } from './input-styles';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 py-1 pointer-coarse:min-h-11 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body-sm file:font-medium',
        fieldClasses,
        className,
      )}
      {...props}
    />
  );
}

export { Input };
