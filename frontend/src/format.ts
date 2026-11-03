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
