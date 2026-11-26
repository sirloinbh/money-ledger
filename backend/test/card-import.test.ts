import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCardSheet } from '../src/ledger/card-import-parse.js';

// Fake data only. The layout follows the Woori Card export described on #56 (2026-11-18).
const header = ['이용일', '승인번호', '이용카드', '이용가맹점(은행)명'];
const domestic = (...rows: string[][]) => [
  ['국내 이용내역'],
  ['(2025.12.01 ~ 2026.01.31)'],
  header,
  ...rows,
];
const row = (
  when: string,
  approval: string,
  shop: string,
  amount: string,
  cancel = '',
  type = '일시불',
  months = '',
) => [when, approval, '1234', shop, '1234567890', type, months, amount, cancel, '2026.02.10'];

test('domestic rows become payments, with the year taken from the period', () => {
  const parsed = parseCardSheet(
    'domestic',
    domestic(
      row('01.05 10:20:30', '12345678', '스타벅스', '4,500'),
      header,
      row('12.30 09:00:00', '22222222', 'GS25', '1,200'),
    ),
  );
  assert.ok(!('error' in parsed));
  assert.deepEqual(
    parsed.payments.map((p) => [p.date, p.amount, p.card, p.approval]),
    [
      ['2026-01-05', 4500, '1234', '12345678'],
      ['2025-12-30', 1200, '1234', '22222222'],
    ],
  );
  assert.equal(parsed.problems.length, 0);
});

test('a cancellation is netted and a full cancellation has amount 0', () => {
  const parsed = parseCardSheet(
    'domestic',
    domestic(
      row('01.05 10:20:30', '1', '가', '10,000', '3,000'),
      row('01.06 10:20:30', '2', '나', '10,000', '10,000'),
    ),
  );
  assert.ok(!('error' in parsed));
  assert.deepEqual(
    parsed.payments.map((p) => [p.amount, p.cancelled]),
    [
      [7000, true],
      [0, true],
    ],
  );
});

test('an installment is one payment at the full amount with the months in the memo', () => {
  const parsed = parseCardSheet(
    'domestic',
    domestic(row('01.05 10:20:30', '1', '가전', '600,000', '', '할부', '6')),
  );
  assert.ok(!('error' in parsed));
  assert.equal(parsed.payments[0].amount, 600000);
  assert.equal(parsed.payments[0].memo, 'Installment 6 months');
});

test('foreign payments take two rows: the amount to pay is used and all-zero rows are authorizations', () => {
  const sheet = [
    ['해외 승인내용'],
    ['(2026.01.01 ~ 2026.01.31)'],
    ['h'],
    ['h2'],
    ['01.10', '1234', 'AMAZON', '일시불', '17,000', 'USD12.34', '17,300', '', '01.12', '02.10'],
    ['10:11:12', '445566', '1385.2500', '12.34', '300', ''],
    ['01.11', '1234', 'CARD CHECK', '일시불', '0', 'USD0.00', '0', '0', '', '미접수'],
    ['10:11:13', '778899', '', '', '0', ''],
  ];
  const parsed = parseCardSheet('foreign', sheet);
  assert.ok(!('error' in parsed));
  assert.equal(parsed.authorizations, 1);
  assert.deepEqual(
    parsed.payments.map((p) => [p.date, p.amount, p.approval, p.memo]),
    [['2026-01-10', 17300, '445566', 'Foreign USD12.34']],
  );
});

test('bad rows are reported by line and a missing period is an error', () => {
  const parsed = parseCardSheet(
    'domestic',
    domestic(row('02.31 10:20:30', '1', '가', '100'), row('01.05 10:20:30', '2', '나', '1.5')),
  );
  assert.ok(!('error' in parsed));
  assert.deepEqual(
    parsed.problems.map((p) => p.line),
    [4, 5],
  );
  assert.ok('error' in parseCardSheet('domestic', [['x']]));
});
