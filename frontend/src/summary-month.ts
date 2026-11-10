// #40 #42 The month the summary shows (`?month=2026-11` in the address, default this month in Seoul). The budget
// card reads the same value, so both always show the same month.

/** The month in the address if it is one the server accepts, else this month. */
export function readSummaryMonth(params: URLSearchParams, today: string) {
  const month = params.get('month') ?? '';
  const year = Number(month.slice(0, 4));
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && year >= 1900 && year <= 2100
    ? month
    : today.slice(0, 7);
}
