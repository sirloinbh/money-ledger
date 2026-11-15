import { requestJson } from './lib/api';

// #43 Fixed costs (decisions 2026-11-15). The app adds the due entries once when it opens, skipped months included.

export const fixedCostsPath = '/api/ledger/fixed-costs';

let dueAdding: Promise<number> | undefined;

/**
 * Adds the due fixed-cost entries when the app opens, at most once per page load. Resolves with how many were
 * added; a failure resolves with 0 and is forgotten, so the next caller (another month, a reload of the card)
 * tries again.
 */
export function addDueOnce() {
  dueAdding ??= requestJson<{ added: number }>(`${fixedCostsPath}/generate`, {
    method: 'POST',
  }).then(
    (data) => data.added,
    () => {
      dueAdding = undefined;
      return 0;
    },
  );
  return dueAdding;
}
