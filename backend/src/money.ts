// #186 Won amounts on the server, in one place. The cap on amounts the user enters and the date rule live in the
// shared contract (shared/contract.ts), so the screens check the same rules before sending.

/**
 * A won amount from PostgreSQL (`bigint` and `numeric` sums come back as strings) as a JSON number. A value outside
 * the safe integer range throws instead of turning into a rounded number; the route answers 500.
 */
export function won(text: string): number;
export function won(text: string | null): number | null;
export function won(text: string | null) {
  if (text === null) return null;
  const amount = Number(text);
  if (!Number.isSafeInteger(amount)) throw new Error(`won amount out of safe range: ${text}`);
  return amount;
}
