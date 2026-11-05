// Shared display and date helpers for the ledger screens.
// "Today" in the service time zone (Asia/Seoul), not the browser's zone or UTC.
export function serviceToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const won = new Intl.NumberFormat('ko-KR');

/** 12500 → "12,500원" */
export function formatWon(amount: number) {
  return `${won.format(amount)}원`;
}

/** A decimal string from the API without trailing zeros and with thousands separators: "1234.5000" → "1,234.5". */
export function formatDecimal(text: string) {
  const [whole, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** "1234.5000" → "1,234.5달러" */
export function formatUsd(text: string) {
  return `${formatDecimal(text)}달러`;
}

/** Commas only as thousands separators ("1,234.5" → "1234.5"); anything else is left in so the check fails. */
export function withoutThousands(text: string) {
  const trimmed = text.trim();
  return /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(trimmed) ? trimmed.replaceAll(',', '') : trimmed;
}

const dateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** An ISO time from the API in the service time zone, e.g. "2026. 11. 5. 오전 10:30". */
export function formatDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}
