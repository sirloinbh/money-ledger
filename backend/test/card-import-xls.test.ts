import assert from 'node:assert/strict';
import { test } from 'node:test';

import { utils, write } from 'xlsx';

import { parseCardSheet } from '../src/ledger/card-import-parse.js';
import { readCardSheet } from '../src/ledger/card-import-xls.js';

const rows = [
  ['우리카드 이용내역'],
  ['(2026.01.01 ~ 2026.01.31)'],
  ['이용일시', '승인번호', '카드', '가맹점', '번호', '구분', '개월', '이용금액', '취소금액'],
  ['01.10 12:30', 'A001', '1234-56**-****-9876', 'Bakery', '1', '일시불', '', '4,500', ''],
];

// A real .xls (BIFF8) file made in memory, so the reader is tested on the format the card site gives.
const book = (bookType: 'biff8' | 'xlsx') => {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), 'Sheet1');
  return write(workbook, { type: 'buffer', bookType }) as Buffer;
};

test('reads the rows of an .xls file as text, and the parser takes them', () => {
  const sheet = readCardSheet(book('biff8'));
  assert.equal(sheet[1][0], '(2026.01.01 ~ 2026.01.31)');
  const parsed = parseCardSheet('domestic', sheet);
  assert.ok(!('error' in parsed));
  assert.deepEqual(
    parsed.payments.map((p) => [p.date, p.card, p.approval, p.merchant, p.amount]),
    [['2026-01-10', '9876', 'A001', 'Bakery', 4500]],
  );
});

test('an .xlsx file reads the same way', () => {
  assert.deepEqual(readCardSheet(book('xlsx'))[3][7], '4,500');
});

test('bytes that are not a sheet never parse as a card file', () => {
  // The reader may throw or return junk rows; either way the parser finds no period and says so.
  const junk = Buffer.from('not a spreadsheet');
  const outcome = (() => {
    try {
      return parseCardSheet('domestic', readCardSheet(junk));
    } catch {
      return { error: 'unreadable' };
    }
  })();
  assert.ok('error' in outcome);
});
