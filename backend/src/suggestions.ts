import type { PoolClient } from 'pg';

// #154 Category suggestions for uncategorized entries, from how the same merchant was classified before
// (decisions 2026-11-16). Nothing leaves the app. Accepting a suggestion classifies the entry only: no rule.

type Kind = 'income' | 'expense';
type Db = Pick<PoolClient, 'query'>;

/** One merchant name of the classified history with one category: how often and when it was last used. */
export type HistoryRow = {
  kind: Kind;
  merchant: string;
  categoryId: number;
  categoryName: string;
  uses: number;
  lastDate: string;
};

type Suggestion = { categoryId: number; categoryName: string; from: string };

/**
 * The merchant compared for suggestions: lower case, without bracketed parts such as "(주)", a trailing branch
 * word ending in 점 or 지점 ("스타벅스 강남점" → "스타벅스"), digits, spaces and punctuation.
 */
export function merchantKey(merchant: string) {
  const words = merchant
    .normalize('NFC')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|㈜/g, ' ')
    .trim()
    .split(/\s+/);
  if (words.length > 1 && words.at(-1)!.endsWith('점')) words.pop();
  return words.join('').replace(/[\d\p{P}\p{S}\s]/gu, '');
}

// A shorter key would make a one-letter name the prefix of half the history.
const minKey = 2;

/** 0: the same merchant, 1: the same key, 2: one key starts with the other, undefined: no match. */
function matchTier(merchant: string, key: string, row: HistoryRow, rowKey: string) {
  if (merchant.toLowerCase() === row.merchant.toLowerCase()) return 0;
  if (key.length < minKey || rowKey.length < minKey) return undefined;
  if (key === rowKey) return 1;
  if (key.startsWith(rowKey) || rowKey.startsWith(key)) return 2;
  return undefined;
}

/**
 * The suggestion for one entry, or null. Only the closest tier of match counts; in it the category used most
 * often wins, then the one used most recently, then the lower ID. `from` names the merchant it comes from.
 */
export function suggest(entry: { kind: Kind; merchant: string }, history: HistoryRow[]) {
  if (!entry.merchant) return null;
  const key = merchantKey(entry.merchant);
  let best: { tier: number; rows: HistoryRow[] } | undefined;
  for (const row of history) {
    if (row.kind !== entry.kind) continue;
    const tier = matchTier(entry.merchant, key, row, merchantKey(row.merchant));
    if (tier === undefined || (best && tier > best.tier)) continue;
    if (!best || tier < best.tier) best = { tier, rows: [row] };
    else best.rows.push(row);
  }
  if (!best) return null;
  const byCategory = new Map<number, { uses: number; latest: HistoryRow }>();
  for (const row of best.rows) {
    const seen = byCategory.get(row.categoryId);
    if (!seen) byCategory.set(row.categoryId, { uses: row.uses, latest: row });
    else {
      seen.uses += row.uses;
      if (row.lastDate > seen.latest.lastDate) seen.latest = row;
    }
  }
  const [winner] = [...byCategory.values()].sort(
    (a, b) =>
      b.uses - a.uses ||
      (a.latest.lastDate < b.latest.lastDate
        ? 1
        : a.latest.lastDate > b.latest.lastDate
          ? -1
          : 0) ||
      a.latest.categoryId - b.latest.categoryId,
  );
  const { categoryId, categoryName, merchant } = winner.latest;
  return { categoryId, categoryName, from: merchant } satisfies Suggestion;
}

/** Classified entries with a merchant, grouped by kind, merchant and category. Hidden categories are left out. */
export async function loadHistory(db: Db): Promise<HistoryRow[]> {
  const { rows } = await db.query<{
    kind: Kind;
    merchant: string;
    category_id: string;
    category_name: string;
    uses: string;
    last_date: string;
  }>(
    `SELECT e.kind, e.merchant, e.category_id, c.name AS category_name, count(*) AS uses,
        to_char(max(e.entry_date), 'YYYY-MM-DD') AS last_date
     FROM ledger_entries e JOIN ledger_categories c ON c.id = e.category_id AND NOT c.hidden
     WHERE e.merchant <> ''
     GROUP BY e.kind, e.merchant, e.category_id, c.name`,
  );
  return rows.map((row) => ({
    kind: row.kind,
    merchant: row.merchant,
    categoryId: Number(row.category_id),
    categoryName: row.category_name,
    uses: Number(row.uses),
    lastDate: row.last_date,
  }));
}
