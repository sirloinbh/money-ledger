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
