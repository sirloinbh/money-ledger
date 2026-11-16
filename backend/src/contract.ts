// #75 Source of truth for input schemas shared by the API and the screens.
// `npm run contract:sync` copies this file to backend/src and frontend/src; never edit the copies.
// The server validates with these schemas (400 with the same messages) and the screens validate with them
// before sending, so both report the same rules. Export only what both sides use (knip checks each copy).
import { z } from 'zod/v4';

/** #37 The kind of a category (and of an entry). */
export const categoryKind = z.enum(['income', 'expense'], {
  error: 'Choose income or expense as the kind',
});

const reservedNames = new Set(['uncategorized', '미분류']);

/** #37 A category name: trimmed, NFC, 1 to 30 characters, not the reserved "Uncategorized". */
export const categoryName = z
  .string({ error: 'Enter a category name' })
  .trim()
  // NFC: Hangul pasted in decomposed form (macOS) must match the composed name for the duplicate check.
  .normalize('NFC')
  .min(1, 'Enter a category name')
  .max(30, 'Enter a category name of 30 characters or fewer')
  // #110 The monthly summary names spending with no category "Uncategorized" (formerly "미분류"), so a category
  // of that name would show as a second row nobody can tell apart. Case and spaces do not make it different.
  .refine((value) => !reservedNames.has(value.replace(/\s+/g, '').toLowerCase()), {
    error: '"Uncategorized" is reserved for entries with no category; choose another name',
  });
