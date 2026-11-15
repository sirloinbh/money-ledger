// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
// How the Combobox filters its suggestions (#437). Kept apart from combobox.tsx so that file
// exports only components (React fast refresh).

export type ComboboxGroup = { label: string; options: readonly string[] };

export const maxComboboxOptions = 8;

/** Spaces and letter case are ignored when names are compared. */
export const looseText = (text: string) => text.replace(/\s+/g, '').toLowerCase();

/**
 * Options that contain the typed text, except the exact value already in the field, at most
 * `max` in total across the groups. Groups left empty are dropped.
 */
export function filterComboboxGroups(groups: readonly ComboboxGroup[], value: string, max = maxComboboxOptions) {
  const typed = looseText(value);
  let left = max;
  const result: ComboboxGroup[] = [];
  for (const group of groups) {
    const options = group.options.filter((option) => looseText(option).includes(typed) && option !== value.trim()).slice(0, left);
    left -= options.length;
    if (options.length) result.push({ label: group.label, options });
  }
  return result;
}
