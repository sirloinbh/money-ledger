import { z } from 'zod/v4';

// #40 #41 A "YYYY-MM" month in a query string and whole-won sums from SQL, shared by the summary APIs.

/**
 * A month the server accepts: YYYY-MM between 1900 and 2100 (the entry dates' range). `label` names the field in
 * the messages ("the month", "the start month"), so two month fields in one query say which one is wrong.
 */
export const monthField = (label: string) =>
  z
    .string({ error: `Enter ${label} as YYYY-MM` })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
      error: `Enter ${label} as YYYY-MM`,
      abort: true,
    })
    .refine(
      (value) => {
        const year = Number(value.slice(0, 4));
        return year >= 1900 && year <= 2100;
      },
      { error: `Enter ${label} between 1900 and 2100` },
    );

/** A sum of whole-won amounts from SQL (numeric as text); exact as long as it is a safe integer. */
export function won(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`sum out of safe range: ${value}`);
  return parsed;
}
