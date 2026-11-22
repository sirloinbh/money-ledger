import assert from 'node:assert/strict';
import { test } from 'node:test';

// #75 The source, not a copy: `npm run contract:check` keeps the copies equal to it.
import {
  categoryKind,
  categoryName,
  MAX_WON,
  MAX_WON_TEXT,
  serviceDate,
} from '../../shared/contract.js';

const message = (value: unknown) => categoryName.safeParse(value).error?.issues[0].message;

test('a category name is trimmed and NFC, 1 to 30 characters', () => {
  assert.equal(categoryName.parse('  Pets '), 'Pets');
  // "가" typed as decomposed jamo (macOS) becomes the composed syllable.
  assert.equal(categoryName.parse('가'), '가');
  assert.equal(categoryName.parse('a'.repeat(30)), 'a'.repeat(30));
  assert.equal(message('   '), 'Enter a category name');
  assert.equal(message(undefined), 'Enter a category name');
  assert.equal(message('a'.repeat(31)), 'Enter a category name of 30 characters or fewer');
  assert.equal(categoryName.maxLength, 30, 'the screen reads its field limit from here');
});

test('"Uncategorized" and "미분류" are reserved, whatever the case and spaces', () => {
  for (const name of ['Uncategorized', ' un Categorized ', '미분류', '미 분 류']) {
    assert.equal(
      message(name),
      '"Uncategorized" is reserved for entries with no category; choose another name',
      name,
    );
  }
  assert.equal(categoryName.parse('Uncategorized stuff'), 'Uncategorized stuff');
});

test('a category kind is income or expense', () => {
  assert.equal(categoryKind.parse('income'), 'income');
  assert.equal(
    categoryKind.safeParse('saving').error?.issues[0].message,
    'Choose income or expense as the kind',
  );
});

test('the one won cap is ₩1 trillion and reads that way in messages (#109, #186)', () => {
  assert.equal(MAX_WON, 1_000_000_000_000);
  assert.equal(MAX_WON_TEXT, '₩1 trillion');
  // Thousands of capped amounts still add up to an exact JS number.
  assert.ok(Number.isSafeInteger(MAX_WON * 9000));
});

test('a service date is a real YYYY-MM-DD date between 1900 and 2100 (#186)', () => {
  const issue = (value: unknown) => serviceDate.safeParse(value).error?.issues[0].message;
  assert.equal(serviceDate.parse('2026-11-22'), '2026-11-22');
  assert.equal(serviceDate.parse('2024-02-29'), '2024-02-29');
  assert.equal(issue('2026-02-30'), 'That date does not exist');
  assert.equal(issue('1899-12-31'), 'Enter a date between 1900 and 2100');
  assert.equal(issue('2101-01-01'), 'Enter a date between 1900 and 2100');
  assert.equal(issue('2026-1-5'), 'Enter the date as YYYY-MM-DD');
  assert.equal(issue(20261122), 'Enter the date as YYYY-MM-DD');
});
