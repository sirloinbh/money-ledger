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

/**
 * #109 #186 The one won cap: ₩1 trillion. Every won amount a person enters (entries, budgets, fixed costs, asset
 * values, trades, prepaid uses, mock orders) and every computed position or valuation is at most this much. Low
 * enough that thousands of them still add up to an exact JS number (Number.MAX_SAFE_INTEGER is about 9 × 10^15).
 * The database CHECK constraints stay at 10^15 as a backstop.
 */
export const MAX_WON = 1_000_000_000_000;

/** #186 How the cap reads in messages: "Enter an amount of ₩1 trillion or less". */
export const MAX_WON_TEXT = '₩1 trillion';

/** #38 A YYYY-MM-DD date in the service calendar: a real date between 1900 and 2100 ("2026-02-30" is not one). */
export const serviceDate = z
  .string({ error: 'Enter the date as YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter the date as YYYY-MM-DD', abort: true })
  // PostgreSQL has no year 0, and far-off years are typos: keep dates in a range a ledger can mean.
  .refine(
    (value) => {
      const year = Number(value.slice(0, 4));
      return year >= 1900 && year <= 2100;
    },
    { error: 'Enter a date between 1900 and 2100', abort: true },
  )
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist');
