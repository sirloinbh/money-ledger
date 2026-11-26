// #57 Reads a Woori Card usage-history sheet (already decoded to rows of text) into payments.
// The format and the rules come from the user's decisions on #56 (2026-11-18). Pure: no file, no database.
//
// Domestic file: one row per payment. Foreign file: two rows per payment (see foreignRows).
// Rules: a cancellation is netted (amount - cancelled); a fully cancelled row has net 0; an all-zero foreign row is a
// card-check authorization and is skipped by the caller; an installment is one payment at the full amount with
// "할부 N개월" in the memo; a pending row (미접수) is a normal payment that a newer file may update.

export type CardKind = 'domestic' | 'foreign';

export type CardPayment = {
  /** The row's position in the sheet (1-based), for messages. */
  line: number;
  date: string;
  /** Last 4 digits of the card. The full number is never in the file or here. */
  card: string;
  approval: string;
  merchant: string;
  /** Won after netting the cancellation (결제금액 - 취소금액 for foreign). 0 means fully cancelled. */
  amount: number;
  /** True when the row carried a cancellation of any size. */
  cancelled: boolean;
  memo: string;
};

export type CardParse = {
  payments: CardPayment[];
  /** Rows that are not payments (card-check authorizations with all zeros). */
  authorizations: number;
  /** Rows that look like payments but cannot be read. */
  problems: { line: number; message: string }[];
};

const periodPattern = /\(\s*(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})\s*\)/;
const monthDayTime = /^(\d{2})\.(\d{2})\s+\d{2}:\d{2}(?::\d{2})?$/;
const monthDay = /^(\d{2})\.(\d{2})$/;
const timeOnly = /^\d{2}:\d{2}(?::\d{2})?$/;

type Period = { startYear: number; startMonth: number; endYear: number };

function findPeriod(rows: string[][]): Period | null {
  for (const row of rows.slice(0, 6)) {
    for (const cell of row) {
      const found = periodPattern.exec(cell ?? '');
      if (found)
        return {
          startYear: Number(found[1]),
          startMonth: Number(found[2]),
          endYear: Number(found[4]),
        };
    }
  }
  return null;
}

/** The sheet shows no year: a period inside one year gives it, and a period over New Year gives the later year to the early months. */
function yearOf(period: Period, month: number) {
  if (period.startYear === period.endYear) return period.startYear;
  return month >= period.startMonth ? period.startYear : period.endYear;
}

function isoDate(period: Period, month: number, day: number) {
  const year = yearOf(period, month);
  const text = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Rejects 02.31 and the like.
  const check = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === text ? text : null;
}

/** "1,234" -> 1234; empty -> 0; anything else is null. Whole won only. */
function wonText(value: string | undefined) {
  const text = (value ?? '').replaceAll(',', '').trim();
  if (text === '') return 0;
  if (!/^\d{1,15}$/.test(text)) return null;
  return Number(text);
}

const clean = (value: string | undefined) => (value ?? '').normalize('NFC').trim();

function installmentMemo(type: string, months: string) {
  const count = /\d+/.exec(months)?.[0];
  const n = count === undefined ? 0 : Number(count);
  if (n > 1) return `Installment ${n} months`;
  if (type.includes('할부') && n === 0) return 'Installment';
  return '';
}

function domesticRows(rows: string[][], period: Period): CardParse {
  const out: CardParse = { payments: [], authorizations: 0, problems: [] };
  rows.forEach((row, index) => {
    const when = monthDayTime.exec(clean(row[0]));
    if (!when) return; // The title, the period, and the header repeated at each page break.
    const line = index + 1;
    const date = isoDate(period, Number(when[1]), Number(when[2]));
    const approval = clean(row[1]);
    const card = clean(row[2]).slice(-4);
    const amount = wonText(row[7]);
    const cancel = wonText(row[8]);
    if (!date)
      return void out.problems.push({ line, message: `Date "${clean(row[0])}" is not a real day` });
    if (!/^\d{4}$/.test(card))
      return void out.problems.push({ line, message: 'The card needs its last 4 digits' });
    if (!approval)
      return void out.problems.push({ line, message: 'The row has no approval number' });
    if (amount === null || cancel === null)
      return void out.problems.push({
        line,
        message: `Amount "${clean(row[7])}" is not a whole number of won`,
      });
    if (amount === 0 && cancel === 0) {
      out.authorizations += 1;
      return;
    }
    out.payments.push({
      line,
      date,
      card,
      approval,
      merchant: clean(row[3]),
      amount: Math.max(amount - cancel, 0),
      cancelled: cancel > 0,
      memo: installmentMemo(clean(row[5]), clean(row[6])),
    });
  });
  return out;
}

/**
 * Foreign payments take two rows. First: date (MM.DD), card, merchant, kind, amount in won, local amount (USD12.34),
 * amount to pay (결제금액, the overseas fee included), cancelled amount, ... Second: time, approval number, rate, ...
 */
function foreignRows(rows: string[][], period: Period): CardParse {
  const out: CardParse = { payments: [], authorizations: 0, problems: [] };
  for (let index = 0; index < rows.length; index += 1) {
    const first = rows[index];
    const when = monthDay.exec(clean(first[0]));
    if (!when) continue;
    const line = index + 1;
    const second = rows[index + 1];
    if (!second || !timeOnly.test(clean(second[0]))) {
      out.problems.push({
        line,
        message: 'A foreign payment needs a second row with the time and approval number',
      });
      continue;
    }
    index += 1;
    const date = isoDate(period, Number(when[1]), Number(when[2]));
    const approval = clean(second[1]);
    const card = clean(first[1]).slice(-4);
    const charged = wonText(first[4]);
    const pay = wonText(first[6]);
    const cancel = wonText(first[7]);
    if (!date) {
      out.problems.push({ line, message: `Date "${clean(first[0])}" is not a real day` });
      continue;
    }
    if (!/^\d{4}$/.test(card)) {
      out.problems.push({ line, message: 'The card needs its last 4 digits' });
      continue;
    }
    if (charged === null || pay === null || cancel === null) {
      out.problems.push({
        line,
        message: `Amount "${clean(first[6])}" is not a whole number of won`,
      });
      continue;
    }
    if (charged === 0 && pay === 0 && cancel === 0) {
      out.authorizations += 1;
      continue;
    }
    if (!approval) {
      out.problems.push({ line, message: 'The row has no approval number' });
      continue;
    }
    const local = clean(first[5]);
    out.payments.push({
      line,
      date,
      card,
      approval,
      merchant: clean(first[2]),
      amount: Math.max(pay - cancel, 0),
      cancelled: cancel > 0,
      memo: local ? `Foreign ${local}` : 'Foreign',
    });
  }
  return out;
}

/** Reads the sheet. `rows` is every row of the file's one sheet, each a list of cell text. */
export function parseCardSheet(kind: CardKind, rows: string[][]): CardParse | { error: string } {
  const period = findPeriod(rows);
  if (!period)
    return { error: 'The file has no period like (2026.01.01 ~ 2026.01.31) in its first rows' };
  return kind === 'domestic' ? domesticRows(rows, period) : foreignRows(rows, period);
}
