import { describe, expect, test } from 'vitest';

import {
  type Category,
  categoryChoice,
  draftFromEntry,
  entryLabel,
  parseAmount,
} from './entry-model';

// #190 The entries screen's pure helpers, checked without rendering.

test('parseAmount takes whole won with or without separators and nothing else', () => {
  expect(parseAmount('12,500')).toBe(12500);
  expect(parseAmount(' 0 ')).toBe(0);
  expect(parseAmount('-1')).toBeUndefined();
  expect(parseAmount('1.5')).toBeUndefined();
  expect(parseAmount('12a')).toBeUndefined();
  expect(parseAmount('')).toBeUndefined();
  expect(parseAmount('99999999999999999')).toBeUndefined();
  // #109 #186 The one won cap, the same as the server's.
  expect(parseAmount('1,000,000,000,000')).toBe(1_000_000_000_000);
  expect(parseAmount('1000000000001')).toBeUndefined();
});

test('draftFromEntry and entryLabel show an uncategorized entry as such', () => {
  const entry = {
    id: 1,
    date: '2026-11-05',
    kind: 'expense' as const,
    amount: 12500,
    categoryId: null,
    categoryName: null,
    merchant: 'Cafe',
    memo: '',
    paymentMethod: 'cash' as const,
    splits: [],
  };
  expect(draftFromEntry(entry)).toEqual({
    date: '2026-11-05',
    kind: 'expense',
    amount: '12500',
    categoryId: '',
    merchant: 'Cafe',
    memo: '',
    paymentMethod: 'cash',
    splits: [],
  });
  expect(entryLabel(entry)).toBe('2026-11-05 Uncategorized ₩12,500');
});

describe('categoryChoice', () => {
  const categories: Category[] = [
    { id: 1, kind: 'expense', name: 'Food', hidden: false },
    { id: 2, kind: 'expense', name: 'Old', hidden: true },
    { id: 3, kind: 'income', name: 'Salary', hidden: false },
  ];

  test('offers visible categories of the kind, plus the hidden one the edited entry has', () => {
    const ids = (edited: number | null | undefined) =>
      categoryChoice(categories, true, { kind: 'expense', categoryId: '' }, edited).choices.map(
        (category) => category.id,
      );
    expect(ids(undefined)).toEqual([1]);
    expect(ids(2)).toEqual([1, 2]);
  });

  test('a choice no longer offered is stale and sent as none, but only once the categories are loaded', () => {
    expect(
      categoryChoice(categories, true, { kind: 'expense', categoryId: '2' }, undefined),
    ).toMatchObject({ stale: true, categoryId: '' });
    expect(
      categoryChoice(categories, true, { kind: 'income', categoryId: '1' }, undefined),
    ).toMatchObject({ stale: true, categoryId: '' });
    expect(
      categoryChoice([], false, { kind: 'expense', categoryId: '2' }, undefined),
    ).toMatchObject({ stale: false, categoryId: '2' });
    expect(
      categoryChoice(categories, true, { kind: 'expense', categoryId: '1' }, undefined),
    ).toMatchObject({ stale: false, categoryId: '1' });
  });
});
