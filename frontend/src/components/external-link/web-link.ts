// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/external-link/
// Returns the address when it is an absolute http or https URL, and null for anything else.
export function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
