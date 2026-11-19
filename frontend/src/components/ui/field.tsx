// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type { ReactNode } from 'react';

import { fieldErrorId } from './field-props';

// The message under a form control (#689, from #64). It sits outside the <label> so the control's accessible name stays
// the label; link the two with invalidProps(name, message) on the control. Renders nothing without a message.
function FieldError({ name, children }: { name: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <span data-slot="field-error" id={fieldErrorId(name)} className="block text-caption font-semibold text-destructive">
      {children}
    </span>
  );
}

export { FieldError };
