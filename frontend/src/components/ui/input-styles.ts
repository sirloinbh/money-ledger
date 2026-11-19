// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
// The look every text-like field shares (Input, Textarea, NativeSelect), so apps stop copying the class list (#688).
// Kept apart from input.tsx so that file exports only components (React fast refresh).

export const fieldClasses = [
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-body-sm dark:bg-input/30',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
].join(' ');
