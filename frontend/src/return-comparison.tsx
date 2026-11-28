import { useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { formatDecimal, formatWon, signedPercent } from './format';
import { serviceToday } from './lib/format';
import { apiKey, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { useLoadError } from './query-reads';

// #294 The mock account's time-weighted return for a period (user decision 2026-11-24: money added or taken out
// is not counted as a gain or a loss). The server does the calculation; this card shows it with the values it
// starts and ends from, and lines it up with what the same days would have earned at the Bank of Korea base rate and
// at two fixed yearly rates (user decision 2026-11-24).

type Period = '1m' | '3m' | 'all';
type Benchmark = {
  id: string;
  name: string;
  annualPct: string | null;
  returnPct: string | null;
};
type AccountReturn = {
  startDate: string | null;
  endDate: string | null;
  startValueKrw: number | null;
  endValueKrw: number | null;
  netCashFlowKrw: number;
  days: number;
  returnPct: string | null;
};

const periods: { value: Period; label: string; months: number | null }[] = [
  { value: '1m', label: '1 month', months: 1 },
  { value: '3m', label: '3 months', months: 3 },
  { value: 'all', label: 'All', months: null },
];

/** "2026-11-10" minus `months` months, as YYYY-MM-DD (the day is clamped, so 3-31 minus 1 is 2-28). */
function monthsBefore(date: string, months: number) {
  const target = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 - months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(Number(date.slice(8, 10)), lastDay));
  return target.toISOString().slice(0, 10);
}

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);

/** Reloads with every mock change: its key starts with the mock key (`/api/mock`), like the other mock reads. */
export function ReturnComparison({ accountId }: { accountId: number }) {
  const [period, setPeriod] = useState<Period>('1m');
  const months = periods.find((item) => item.value === period)?.months ?? null;
  const from = months === null ? null : monthsBefore(serviceToday(), months);
  const path = `/api/mock/accounts/${accountId}/return${from ? `?from=${from}` : ''}`;
  const read = useApiQuery<{ account: AccountReturn; benchmarks: Benchmark[] }>(
    apiKey('/api/mock', 'accounts', accountId, 'return', period),
    path,
  );
  const notice = useNotice();
  useLoadError(read.error, notice.error, 'Could not load the return');
  const result = read.data?.account;
  const benchmarks = read.data?.benchmarks ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">Return of your decisions</CardTitle>
        <CardDescription>
          The return of your trades, not of the money you add, next to what the same days would have
          earned elsewhere. A deposit or a withdrawal is not counted as a gain or a loss.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="group" aria-label="Return period" className="flex gap-2">
          {periods.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={period === item.value ? 'default' : 'outline'}
              aria-pressed={period === item.value}
              onClick={() => setPeriod(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <Notice id="return-comparison-notice" notice={notice.notice} />
        {!result ? (
          notice.notice?.kind === 'error' ? null : (
            <p role="status" className="text-body-sm text-muted-foreground">
              Loading the return
            </p>
          )
        ) : result.returnPct === null ? (
          <p className="text-body-sm text-muted-foreground">
            No return yet for this period. It needs a saved value for a day after the start.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-body-sm text-muted-foreground">Time-weighted return</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {signedPercent(result.returnPct)}
              </dd>
            </div>
            <div>
              <dt className="text-body-sm text-muted-foreground">Period</dt>
              <dd className="tabular-nums">
                {result.startDate} to {result.endDate}
              </dd>
            </div>
            <div>
              <dt className="text-body-sm text-muted-foreground">Total assets at the start</dt>
              <dd className="tabular-nums">
                {result.startValueKrw === null ? '-' : formatWon(result.startValueKrw)}
              </dd>
            </div>
            <div>
              <dt className="text-body-sm text-muted-foreground">Total assets at the end</dt>
              <dd className="tabular-nums">
                {result.endValueKrw === null ? '-' : formatWon(result.endValueKrw)}
              </dd>
            </div>
            <div>
              <dt className="text-body-sm text-muted-foreground">Money added or taken out</dt>
              <dd className="tabular-nums">{signedWon(result.netCashFlowKrw)}</dd>
            </div>
          </dl>
        )}
        {result && result.returnPct !== null ? (
          <table className="w-full text-body-sm">
            <caption className="sr-only">
              Return of your trades next to the benchmarks over the same days
            </caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 font-medium">
                  Compared with
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Per year
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Return
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <th scope="row" className="py-2 text-left font-medium">
                  Your trades
                </th>
                <td className="py-2 text-right">-</td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {signedPercent(result.returnPct)}
                </td>
              </tr>
              {benchmarks.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <th scope="row" className="py-2 text-left font-normal">
                    {item.name}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {item.annualPct === null ? '-' : `${formatDecimal(item.annualPct)}%`}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {item.returnPct === null ? 'No rate yet' : signedPercent(item.returnPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </CardContent>
    </Card>
  );
}
