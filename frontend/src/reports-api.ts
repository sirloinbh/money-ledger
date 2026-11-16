import { addDueOnce } from './fixed-costs-api';
import { requestJson } from './lib/api';
import { formatMonthDay } from './quote-format';
import { monthLabel } from './trend-series';

// #62 Weekly (Sunday to Saturday) and monthly spending reports (decisions 2026-11-16). Opening the app saves the
// report of each finished period once; a report is a snapshot of when it was made. A new one is announced on the
// dashboard until it is opened.

export const reportsPath = '/api/reports';

export type ReportItem = {
  id: number;
  period: 'week' | 'month';
  startDate: string;
  endDate: string;
  /** The service date the report was made on. */
  madeOn: string;
  seen: boolean;
  total: number;
};

export type Report = ReportItem & {
  previousTotal: number;
  /** Spending minus the previous period's: negative when it went down. */
  change: number;
  topCategories: {
    categoryId: number | null;
    name: string;
    hidden: boolean;
    amount: number;
    /** A percentage of the period's spending with one decimal, from the server: "35.2". */
    share: string;
  }[];
  /** Categories at or over their budget; null for a weekly report (budgets are monthly). */
  overspending:
    | {
        categoryId: number;
        name: string;
        hidden: boolean;
        spent: number;
        budget: number;
        over: number;
        percent: string;
        status: 'reached' | 'over';
      }[]
    | null;
};

let making: Promise<void> | undefined;

/**
 * Saves the reports of finished periods, at most once per page load. It waits for the due fixed-cost entries
 * first, since they count as spending. A failure is forgotten, so the next caller tries again.
 */
export function makeReportsOnce() {
  making ??= addDueOnce()
    .then(() => requestJson(`${reportsPath}/generate`, { method: 'POST' }))
    .then(
      () => undefined,
      () => {
        making = undefined;
      },
    );
  return making;
}

/** "Week of Nov 8 – Nov 14, 2026" or "October 2026". */
export const periodLabel = (report: Pick<ReportItem, 'period' | 'startDate' | 'endDate'>) =>
  report.period === 'month'
    ? monthLabel(report.startDate.slice(0, 7))
    : `Week of ${formatMonthDay(report.startDate)} – ${formatMonthDay(report.endDate)}, ${report.endDate.slice(0, 4)}`;
