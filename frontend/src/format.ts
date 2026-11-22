// Shared display and date helpers for the ledger screens.
import { MAX_WON, serviceDate } from '../../shared/contract';

// "Today" in the service time zone (Asia/Seoul), not the browser's zone or UTC.
export function serviceToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A real YYYY-MM-DD date between 1900 and 2100, the range the server accepts ("2026-02-30" is not one). */
export function realDate(text: string) {
  // The same rule as the server (#186): shared/contract.ts.
  return serviceDate.safeParse(text).success;
}

/**
 * #186 Whole won from plain digits (thousands commas already removed), or undefined when it is not 0 to MAX_WON,
 * the one won cap the server also checks.
 */
export function wonFromDigits(digits: string) {
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const value = Number(digits);
  return value <= MAX_WON ? value : undefined;
}

const won = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KRW' });

/** 12500 → "₩12,500" */
export function formatWon(amount: number) {
  return won.format(amount);
}

/** A decimal string from the API without trailing zeros and with thousands separators: "1234.5000" → "1,234.5". */
export function formatDecimal(text: string) {
  const [whole, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** "1 row", "2 rows", "1,234 entries": a count and its noun in the right number (#203). */
export function countOf(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** "1 share", "1.5 shares", "1,200 shares": a decimal quantity string from the API with its noun (#203). */
export const sharesOf = (quantity: string) =>
  `${formatDecimal(quantity)} ${/^0*1(\.0*)?$/.test(quantity) ? 'share' : 'shares'}`;

/** "1234.5000" → "$1,234.5" */
export function formatUsd(text: string) {
  return `$${formatDecimal(text)}`;
}

/** Commas only as thousands separators ("1,234.5" → "1234.5"); anything else is left in so the check fails. */
export function withoutThousands(text: string) {
  const trimmed = text.trim();
  return /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(trimmed) ? trimmed.replaceAll(',', '') : trimmed;
}

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** An ISO time from the API in the service time zone, e.g. "Nov 5, 2026, 10:30 AM". */
export function formatDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}

/** A percentage string from the API with its sign: "13.31" → "+13.31%", "-0.05" → "-0.05%", "0.00" → "0%". */
export function signedPercent(text: string) {
  const negative = text.startsWith('-');
  const digits = formatDecimal(negative ? text.slice(1) : text);
  if (digits === '0') return '0%';
  return `${negative ? '-' : '+'}${digits}%`;
}
