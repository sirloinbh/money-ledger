import type { Pool } from 'pg';

import { accountReturn, benchmarkReturns } from '../benchmark.js';
import type { Comparison } from './messages.js';

/**
 * #313 The deposit, Buffett and Renaissance returns for the daily summary, over the same days as the account's own
 * return (#294): from its start to its last known value. undefined when the account has no period yet (no day after
 * its start), so the summary leaves the line out. A figure that is not known (the deposit without a stored base
 * rate) is null and shows as "n/a".
 */
export async function comparisonFor(
  pool: Pool,
  accountId: number,
  day: string,
): Promise<Comparison | undefined> {
  const account = await accountReturn(pool, accountId, day);
  if (account.returnPct === null) return undefined;
  const benchmarks = await benchmarkReturns(pool, account.startDate, account.endDate);
  const pct = (id: string) => benchmarks.find((item) => item.id === id)?.returnPct ?? null;
  return {
    depositPct: pct('deposit'),
    buffettPct: pct('buffett'),
    renaissancePct: pct('renaissance'),
  };
}
