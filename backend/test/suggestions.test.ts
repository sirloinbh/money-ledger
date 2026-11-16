import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type HistoryRow, merchantKey, suggest } from '../src/suggestions.js';

const row = (merchant: string, categoryId: number, more: Partial<HistoryRow> = {}): HistoryRow => ({
  kind: 'expense',
  merchant,
  categoryId,
  categoryName: `C${categoryId}`,
  uses: 1,
  lastDate: '2026-11-01',
  ...more,
});
const expense = (merchant: string) => ({ kind: 'expense' as const, merchant });

test('the merchant key drops a branch word, brackets, digits, spaces and punctuation', () => {
  assert.equal(merchantKey('스타벅스 강남점'), '스타벅스');
  assert.equal(merchantKey('스타벅스 역삼R점'), '스타벅스');
  assert.equal(merchantKey('이마트 성수지점'), '이마트');
  assert.equal(merchantKey('GS25 역삼1호점'), 'gs');
  assert.equal(merchantKey('쿠팡(주)'), '쿠팡');
  assert.equal(merchantKey('㈜우아한형제들'), '우아한형제들');
  assert.equal(merchantKey('NICE_Netflix.com'), 'nicenetflixcom');
  // A single word is the name itself, even when it ends in 점.
  assert.equal(merchantKey('철물점'), '철물점');
  assert.equal(merchantKey('1234'), '');
});

test('branch variants and longer names of the same merchant are suggested', () => {
  const history = [row('스타벅스 강남점', 1), row('이마트', 2)];
  assert.deepEqual(suggest(expense('스타벅스 역삼점'), history), {
    categoryId: 1,
    categoryName: 'C1',
    from: '스타벅스 강남점',
  });
  assert.equal(suggest(expense('이마트에브리데이 성수'), history)?.categoryId, 2);
  assert.equal(suggest(expense('동네 철물점'), history), null);
});

test('no suggestion without a merchant, for another kind, or from a too-short key', () => {
  assert.equal(suggest(expense(''), [row('', 1)]), null);
  assert.equal(suggest({ kind: 'income', merchant: '스타벅스' }, [row('스타벅스', 1)]), null);
  // "A1" keeps only "a": one letter must not be the prefix of everything starting with it.
  assert.equal(suggest(expense('A1'), [row('Apple', 1)]), null);
  // The same name still matches when its key is short.
  assert.equal(suggest(expense('a1'), [row('A1', 1)])?.categoryId, 1);
});

test('the closest match wins over more uses further away', () => {
  const history = [
    row('스타벅스', 1, { uses: 9 }),
    row('스타벅스 강남점', 2, { uses: 1 }),
    row('스타벅스커피', 3, { uses: 20 }),
  ];
  // The same merchant first.
  assert.equal(suggest(expense('스타벅스 강남점'), history)?.categoryId, 2);
  // Then the same key ("스타벅스"), not the prefix match with more uses.
  assert.equal(suggest(expense('스타벅스 역삼점'), history)?.categoryId, 1);
});

test('within a match the most used category wins, then the most recent one', () => {
  const history = [
    row('스타벅스 강남점', 1, { uses: 2, lastDate: '2026-10-01' }),
    row('스타벅스 역삼점', 2, { uses: 1, lastDate: '2026-11-10' }),
    row('스타벅스 성수점', 2, { uses: 2, lastDate: '2026-09-01' }),
  ];
  // Category 2: three uses across two branches; `from` is its most recent merchant.
  assert.deepEqual(suggest(expense('스타벅스 서초점'), history), {
    categoryId: 2,
    categoryName: 'C2',
    from: '스타벅스 역삼점',
  });
  const tie = [
    row('이마트 성수점', 1, { uses: 1, lastDate: '2026-10-01' }),
    row('이마트 왕십리점', 2, { uses: 1, lastDate: '2026-11-01' }),
  ];
  assert.equal(suggest(expense('이마트 용산점'), tie)?.categoryId, 2);
});
