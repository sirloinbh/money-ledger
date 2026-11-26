// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { ChevronDownIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { fieldClasses } from './input-styles';

// The browser's own <select> in the Input look (#688). Use it for a short list on a form: it has the native picker on
// phones and works with a plain <label htmlFor>. Pass <option> children. For a styled list with groups use Select.

function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div data-slot="native-select-wrapper" className="relative w-full">
      <select data-slot="native-select" className={cn('h-10 cursor-pointer appearance-none py-1 pr-9 pointer-coarse:min-h-12', fieldClasses, className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
