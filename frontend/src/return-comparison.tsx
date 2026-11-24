import { useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { formatWon, serviceToday, signedPercent } from './format';
import { apiKey, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { useLoadError } from './query-reads';

// #294 The mock account's time-weighted return for a period (user decision 2026-11-24: money added or taken out
// is not counted as a gain or a loss). The server does the calculation; this card shows it with the values it
// starts and ends from. Deposit and index comparisons are added to this card in later issues.

type Period = '1m' | '3m' | 'all';
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
  const read = useApiQuery<{ account: AccountReturn }>(
    apiKey('/api/mock', 'accounts', accountId, 'return', period),
    path,
  );
  const notice = useNotice();
  useLoadError(read.error, notice.error, 'Could not load the return');
  const result = read.data?.account;

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">Return of your decisions</CardTitle>
        <CardDescription>
          The return of your trades, not of the money you add. A deposit or a withdrawal is not
          counted as a gain or a loss.
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
      </CardContent>
    </Card>
  );
}
