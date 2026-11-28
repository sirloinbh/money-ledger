// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/file-field/
import type * as React from 'react';

import { cn } from '../../lib/utils';

// A file picker that shows an English button instead of the browser's own control, whose text follows the browser
// language (same reason as DateField, #1138). The real <input type="file"> stays in the page for the keyboard and
// screen readers: it is visually hidden, Enter and Space on it open the picker, and the button shows the focus ring.
// `onFiles` gets the chosen files, and the input is cleared right after, so choosing the same file again still fires.
function FileField({
  children = 'Choose file',
  onFiles,
  accept,
  multiple,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type' | 'onChange' | 'children'> & {
  children?: React.ReactNode;
  onFiles: (files: File[]) => void;
}) {
  return (
    <label
      data-slot="file-field"
      className={cn(
        'relative inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-body-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50 pointer-coarse:min-h-12',
        className,
      )}
    >
      <input
        {...props}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      {children}
    </label>
  );
}

export { FileField };
