import { expect, test } from 'vitest';

import {
  dataRowCount,
  exportUrl,
  guessMapping,
  headerIndex,
  notUtf8,
  parseCsv,
  toImportRows,
} from './entry-csv-parse';

const filters = {
  from: '2026-11-01',
  to: '2026-11-30',
  kind: '',
  category: '',
  q: ' 커피 ',
  page: 3,
} as const;

test('the download link takes the filters but not the page', () => {
  expect(exportUrl({ ...filters })).toBe(
    '/api/ledger/entries/csv?from=2026-11-01&to=2026-11-30&q=%EC%BB%A4%ED%94%BC',
  );
  expect(exportUrl({ ...filters, from: '', to: '', q: '' })).toBe('/api/ledger/entries/csv');
});

test('CSV fields: BOM, quotes, doubled quotes, commas and line breaks inside quotes, CRLF, empty lines', () => {
  const text = `${String.fromCharCode(0xfeff)}date,memo\r\n2026-11-01,"a, ""b""\r\nc"\r\n\r\n2026-11-02,\n`;
  expect(parseCsv(text)).toEqual([
    ['date', 'memo'],
    ['2026-11-01', 'a, "b"\r\nc'],
    // Kept, so each row's index stays its row number in a spreadsheet.
    [''],
    ['2026-11-02', ''],
  ]);
  expect(parseCsv('x,y')).toEqual([['x', 'y']]);
  // A quote inside an unquoted field is kept as it is; a lone CR ends a row.
  expect(parseCsv('ab"c,d\re')).toEqual([['ab"c', 'd'], ['e']]);
});

test('blank rows and rows of only commas are left out, and row numbers stay those of the sheet', () => {
  const rows = parseCsv('date,amount\n\n2026-11-01,1\n,\n2026-11-02,2\n,,\n');
  const mapping = guessMapping(rows[0]);
  expect(toImportRows(rows, mapping, 'expense').map((row) => [row.line, row.amount])).toEqual([
    [3, '1'],
    [5, '2'],
  ]);
  expect(dataRowCount(rows)).toBe(2);
});

test('columns are guessed from English or Korean headers, each column used once', () => {
  expect(guessMapping(['date', 'kind', 'amount', 'category', 'merchant', 'memo'])).toEqual({
    date: 0,
    kind: 1,
    amount: 2,
    category: 3,
    merchant: 4,
    memo: 5,
  });
  expect(guessMapping(['이용일자', '가맹점명', '이용금액', '비고'])).toEqual({
    date: 0,
    kind: -1,
    amount: 2,
    category: -1,
    merchant: 1,
    memo: 3,
  });
});

test('rows are cleaned for the server, and the line counts the header as 1', () => {
  const rows = [
    ['날짜', '구분', '금액', '가맹점'],
    ['2026.11.05', '지출', '₩12,500', ' 스타벅스 '],
    ['2026/11/06', '수입', '3,000,000원', 'Company'],
    ['11/07', 'spend', '1.5', ''],
  ];
  expect(toImportRows(rows, guessMapping(rows[0]), 'expense')).toEqual([
    {
      line: 2,
      date: '2026-11-05',
      kind: 'expense',
      amount: '12500',
      category: '',
      merchant: '스타벅스',
      memo: '',
    },
    {
      line: 3,
      date: '2026-11-06',
      kind: 'income',
      amount: '3000000',
      category: '',
      merchant: 'Company',
      memo: '',
    },
    // Left as they are, so the server names the problem.
    { line: 4, date: '11/07', kind: 'spend', amount: '1.5', category: '', merchant: '', memo: '' },
  ]);
  const noKind = { date: 0, kind: -1, amount: 1, category: -1, merchant: -1, memo: -1 };
  expect(
    toImportRows(
      [
        ['d', 'a'],
        ['2026-11-01', '1'],
      ],
      noKind,
      'income',
    )[0].kind,
  ).toBe('income');
});

test('a file that was not UTF-8 is noticed', () => {
  expect(notUtf8(`a${String.fromCharCode(0xfffd)}b`)).toBe(true);
  expect(notUtf8('스타벅스')).toBe(false);
});

test('blank lines before the header are skipped, and the header is the first row with something in it', () => {
  const rows = parseCsv('\n,,\nDate,Amount\n2026-11-01,500\n');
  expect(headerIndex(rows)).toBe(2);
  const mapping = guessMapping(rows[headerIndex(rows)]);
  expect([mapping.date, mapping.amount]).toEqual([0, 1]);
  expect(toImportRows(rows, mapping, 'expense').map((row) => [row.line, row.date])).toEqual([
    [4, '2026-11-01'],
  ]);
  expect(dataRowCount(rows)).toBe(1);
});
