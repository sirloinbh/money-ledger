import type { FilterCategory, Kind } from './entry-filters-state';
import { formatWon, serviceToday, wonFromDigits } from './format';

// #190 The entries screen's types and pure helpers, kept apart from the components so they can be unit-tested.

export type Category = FilterCategory;
export type PaymentMethod = 'credit_card' | 'debit_card' | 'cash';
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  cash: 'Cash',
};
export type Entry = {
  id: number;
  date: string;
  kind: Kind;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string;
  memo: string;
  /** #296 Null: unknown. */
  paymentMethod: PaymentMethod | null;
  /** #292 The parts of a split payment (they add up to the amount); empty when it is not split. */
  splits: { categoryId: number; categoryName: string; amount: number }[];
};
/** One part of a split in the form: the category id and the amount as typed. */
export type DraftPart = { categoryId: string; amount: string };
export type Draft = {
  date: string;
  kind: Kind;
  amount: string;
  categoryId: string;
  merchant: string;
  memo: string;
  /** '' is unknown. */
  paymentMethod: PaymentMethod | '';
  /** #292 Empty: not split. */
  splits: DraftPart[];
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
  paymentMethod: '',
  splits: [],
});

/** The form draft for editing an entry. */
export const draftFromEntry = (entry: Entry): Draft => ({
  date: entry.date,
  kind: entry.kind,
  amount: String(entry.amount),
  categoryId: entry.categoryId === null ? '' : String(entry.categoryId),
  merchant: entry.merchant,
  memo: entry.memo,
  paymentMethod: entry.paymentMethod ?? '',
  splits: (entry.splits ?? []).map((part) => ({
    categoryId: String(part.categoryId),
    amount: String(part.amount),
  })),
});

/**
 * The parts of a split draft for the server, or the message that says what is wrong. Each part needs a category and
 * a whole-won amount of 1 or more, and the parts must add up to the payment (`total`).
 */
export function partsFromDraft(parts: DraftPart[], total: number) {
  const out: { categoryId: number; amount: number }[] = [];
  for (const [index, part] of parts.entries()) {
    const amount = parseAmount(part.amount);
    if (!part.categoryId) return { error: `Choose a category for part ${index + 1}` };
    if (amount === undefined || amount < 1) {
      return { error: `Enter an amount of ₩1 or more for part ${index + 1}` };
    }
    out.push({ categoryId: Number(part.categoryId), amount });
  }
  if (new Set(out.map((part) => part.categoryId)).size !== out.length) {
    return { error: 'Use each category once. Add the amounts of the same category together' };
  }
  const sum = out.reduce((acc, part) => acc + part.amount, 0);
  if (sum !== total) {
    return {
      error: `The parts add up to ${formatWon(sum)} but the payment is ${formatWon(total)}`,
    };
  }
  return { parts: out };
}

/** "12,500" or "12500" → 12500; anything else (sign, decimals, letters) → undefined. */
export function parseAmount(text: string) {
  return wonFromDigits(text.replaceAll(',', '').trim());
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
