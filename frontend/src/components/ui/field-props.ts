// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
// Ids for field messages: "sets.0.weight" becomes "issue-sets-0-weight".
export const fieldErrorId = (name: string) => 'issue-' + name.replace(/\./g, '-');

// Props that link a control to its message (#64): aria-invalid and aria-describedby.
export function invalidProps(name: string, message?: string) {
  return message ? { 'aria-invalid': true as const, 'aria-describedby': fieldErrorId(name) } : {};
}
