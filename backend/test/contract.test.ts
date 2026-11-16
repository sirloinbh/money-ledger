import assert from 'node:assert/strict';
import { test } from 'node:test';

// #75 The source, not a copy: `npm run contract:check` keeps the copies equal to it.
import { categoryKind, categoryName } from '../../shared/contract.js';

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
