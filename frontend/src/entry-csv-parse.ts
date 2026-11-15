import { apiQuery, type Filters } from './entry-filters-state';
import { withoutThousands } from './format';

// #44 Entries as CSV (decisions 2026-11-16). The browser reads the file and maps its columns; the server checks
// the rows and saves them. Only UTF-8 files are read for now (CP949 bank files come with #57-#59).

export const entryCsvPath = '/api/ledger/entries/csv';
export const maxImportRows = 2000;
const bom = String.fromCharCode(0xfeff);
const replacement = String.fromCharCode(0xfffd);

/** The download link for the entries the list's filters match (every page, not just the one shown). */
export function exportUrl(filters: Filters) {
  const params = new URLSearchParams(apiQuery(filters, 1));
  params.delete('page');
  params.delete('size');
  const query = params.toString();
  return query ? `${entryCsvPath}?${query}` : entryCsvPath;
}

/**
 * Splits CSV text into rows of fields (RFC 4180): quoted fields may hold commas, doubled quotes and line
 * breaks; lines end with CRLF or LF. A leading BOM is dropped. Empty lines are kept as rows, so a row's index
 * is its row number in a spreadsheet; `toImportRows` leaves them out.
 */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.startsWith(bom) ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') endRow();
    else if (char === '\r') {
      if (source[i + 1] === '\n') i++;
      endRow();
    } else field += char;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export const fields = ['date', 'kind', 'amount', 'category', 'merchant', 'memo'] as const;
export type Field = (typeof fields)[number];
/** Which column of the file feeds each field: a column index, or -1 for none. */
export type Mapping = Record<Field, number>;
/** The kind for every row when the file has no kind column. */
export type FixedKind = 'expense' | 'income';

export const fieldLabel: Record<Field, string> = {
  date: 'Date',
  kind: 'Kind',
  amount: 'Amount',
  category: 'Category',
  merchant: 'Merchant',
  memo: 'Note',
};

// Header names this app exports, and the usual Korean ones in bank and card statements.
const headerNames: Record<Field, string[]> = {
  date: ['date', '날짜', '일자', '거래일', '거래일자', '이용일', '이용일자', '사용일'],
  kind: ['kind', 'type', '구분', '유형', '수입/지출', '입출금'],
  amount: ['amount', '금액', '거래금액', '이용금액', '사용금액'],
  category: ['category', '분류', '카테고리'],
  merchant: ['merchant', '가맹점', '가맹점명', '상호', '사용처', '내용', '적요'],
  memo: ['memo', 'note', '메모', '비고'],
};

/** Guesses the mapping from the header row; a field with no matching header gets -1. */
export function guessMapping(header: string[]): Mapping {
  const names = header.map((name) => name.trim().toLowerCase().normalize('NFC'));
  const taken = new Set<number>();
  const mapping = {} as Mapping;
  for (const field of fields) {
    const index = names.findIndex((name, i) => !taken.has(i) && headerNames[field].includes(name));
    mapping[field] = index;
    if (index >= 0) taken.add(index);
  }
  return mapping;
}

const kindWords: Record<string, FixedKind> = {
  expense: 'expense',
  income: 'income',
  지출: 'expense',
  수입: 'income',
  출금: 'expense',
  입금: 'income',
};

export type ImportRow = {
  line: number;
  date: string;
  kind: string;
  amount: string;
  category: string;
  merchant: string;
  memo: string;
};

/**
 * The data rows (after the header, see `headerIndex`) as the server takes them, without empty ones (Excel often pads a file with
 * `,,,,` rows). `line` is the row number a spreadsheet shows for the row, counting the header as 1. Kind words in Korean are translated, thousands separators and a
 * leading ₩ are dropped from amounts, and dates like 2026.11.05 or 2026/11/05 become 2026-11-05; anything else
 * is sent as it is, so the server names the problem.
 */
export function toImportRows(rows: string[][], mapping: Mapping, fixedKind: FixedKind) {
  const cell = (row: string[], field: Field) =>
    mapping[field] >= 0 ? (row[mapping[field]] ?? '').trim() : '';
  const header = headerIndex(rows);
  return rows.flatMap((row, index): ImportRow[] => {
    if (index <= header || blank(row)) return [];
    const kind = cell(row, 'kind');
    const date = cell(row, 'date');
    return [
      {
        line: index + 1,
        date: /^\d{4}[./]\d{2}[./]\d{2}$/.test(date) ? date.replace(/[./]/g, '-') : date,
        kind: mapping.kind >= 0 ? (kindWords[kind.toLowerCase()] ?? kind) : fixedKind,
        amount: withoutThousands(cell(row, 'amount').replace(/^₩\s*/, '').replace(/원$/, '')),
        category: cell(row, 'category'),
        merchant: cell(row, 'merchant'),
        memo: cell(row, 'memo'),
      },
    ];
  });
}

/** A row with nothing in it: an empty line or only commas. */
const blank = (row: string[]) => row.every((field) => field.trim() === '');

/** How many data rows the file has: rows after the header that are not blank. */
/** The header is the first row with something in it: a file may start with blank lines. */
export const headerIndex = (rows: string[][]) =>
  Math.max(
    0,
    rows.findIndex((row) => !blank(row)),
  );

export const dataRowCount = (rows: string[][]) =>
  rows.slice(headerIndex(rows) + 1).filter((row) => !blank(row)).length;

/** A file read as UTF-8 that was saved in another encoding has replacement characters in it. */
export const notUtf8 = (text: string) => text.includes(replacement);
