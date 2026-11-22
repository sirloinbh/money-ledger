import type { FilterCategory, Kind } from './entry-filters-state';
import { formatWon, serviceToday } from './format';

// #190 The entries screen's types and pure helpers, kept apart from the components so they can be unit-tested.

export type Category = FilterCategory;
export type Entry = {
  id: number;
  date: string;
  kind: Kind;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string;
  memo: string;
};
export type Draft = {
  date: string;
  kind: Kind;
  amount: string;
  categoryId: string;
  merchant: string;
  memo: string;
};

export const entriesPath = '/api/ledger/entries';
export const pageSize = 50;
/** One loaded page of the list, with the query it answers. */
export type Listing = { query: string; entries: Entry[]; total: number };

export const emptyDraft = (): Draft => ({
  date: serviceToday(),
  kind: 'expense',
  amount: '',
  categoryId: '',
  merchant: '',
  memo: '',
});

/** The form draft for editing an entry. */
export const draftFromEntry = (entry: Entry): Draft => ({
  date: entry.date,
  kind: entry.kind,
  amount: String(entry.amount),
  categoryId: entry.categoryId === null ? '' : String(entry.categoryId),
  merchant: entry.merchant,
  memo: entry.memo,
});

/** "12,500" or "12500" → 12500; anything else (sign, decimals, letters) → undefined. */
export function parseAmount(text: string) {
  const digits = text.replaceAll(',', '').trim();
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * The categories the form offers and whether the chosen one is stale. Offered: the visible categories of the
 * draft's kind, plus the hidden one an edited entry already has. A chosen category that is no longer offered
 * (hidden meanwhile) must be chosen again: saving it as Uncategorized without a word would drop the user's
 * choice. Judged only once the categories are loaded, so a slow or failed load does not flag every choice.
 */
export function categoryChoice(
  categories: Category[],
  loaded: boolean,
  draft: Pick<Draft, 'kind' | 'categoryId'>,
  editedCategoryId: number | null | undefined,
) {
  const choices = categories.filter(
    (category) =>
      category.kind === draft.kind && (!category.hidden || category.id === editedCategoryId),
  );
  const stale =
    loaded &&
    draft.categoryId !== '' &&
    !choices.some((category) => String(category.id) === draft.categoryId);
  return { choices, stale, categoryId: stale ? '' : draft.categoryId };
}

/** "2026-11-05 Food ₩12,500": names a row in button labels and the delete dialog. */
export const entryLabel = (entry: Entry) =>
  `${entry.date} ${entry.categoryName ?? 'Uncategorized'} ${formatWon(entry.amount)}`;
