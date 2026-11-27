import { Link } from 'react-router';

import { Button } from './components/ui/button';
import { formatWon } from './format';
import { type PeriodRow, sumRows } from './period-data';

// #359 The table of day or week totals used by the Week and 12 weeks pages (data: period-data.ts).

/** One row per period with a link on its name; the last row is the total. */
export function PeriodTable({
  caption,
  firstHeading,
  rows,
  rowName,
  rowLink,
  loading,
}: {
  caption: string;
  firstHeading: string;
  rows: PeriodRow[];
  rowName: (row: PeriodRow) => string;
  rowLink: (row: PeriodRow) => string;
  loading: boolean;
}) {
  const total = sumRows(rows);
  return (
    <div aria-busy={loading || undefined} className={loading ? 'opacity-60' : undefined}>
      <table className="w-full text-body-sm whitespace-nowrap tabular-nums max-sm:text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 font-medium">
              {firstHeading}
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Income (KRW)
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Expense (KRW)
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Balance (KRW)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.start} className="border-b">
              <th scope="row" className="py-2 text-left font-normal">
                <Link className="underline underline-offset-2" to={rowLink(row)}>
                  {rowName(row)}
                </Link>
              </th>
              <td className="py-2 pl-3 text-right">{formatWon(row.income)}</td>
              <td className="py-2 pl-3 text-right">{formatWon(row.expense)}</td>
              <td className="py-2 pl-3 text-right">{formatWon(row.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <th scope="row" className="py-2 text-left">
              Total
            </th>
            <td className="py-2 pl-3 text-right">{formatWon(total.income)}</td>
            <td className="py-2 pl-3 text-right">{formatWon(total.expense)}</td>
            <td className="py-2 pl-3 text-right">{formatWon(total.balance)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function PeriodFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-body-sm text-destructive">
        Could not load the totals.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
