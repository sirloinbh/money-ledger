import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { selectClass } from './entry-filters-state';
import { formatWon, serviceToday, wonFromDigits } from './format';
import { refreshLedger } from './ledger-query';
import { apiKey, type ApiRequest, useApiMutation, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { useLoadError } from './query-reads';

// #296 The year's card spending by payment method against the year-end deduction threshold. An estimate: the rules
// (threshold, rates, limits) are the server's and are listed in docs/card-deduction.md.

type Estimate = {
  year: number;
  totalSalary: number | null;
  spending: { creditCard: number; debitCard: number; cash: number; unknown: number };
  estimate: {
    threshold: number;
    counted: number;
    overThreshold: number;
    toThreshold: number;
    deduction: number;
    beforeLimit: number;
    limit: number;
  } | null;
  rules: { thresholdPercent: number; creditPercent: number; debitCashPercent: number };
};

const basePath = '/api/ledger/tax';

export function CardDeductionEstimate() {
  const client = useQueryClient();
  const thisYear = Number(serviceToday().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [salary, setSalary] = useState('');
  const [busy, setBusy] = useState(false);
  const key = apiKey('/api/ledger', 'card-deduction', String(year));
  const read = useApiQuery<Estimate>(key, `${basePath}/card-deduction?year=${year}`);
  const write = useApiMutation<unknown, ApiRequest>((request) => request);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  useLoadError(read.error, showError, 'Could not load the card deduction estimate');
  const data = read.data;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const amount = wonFromDigits(salary.replaceAll(',', '').trim());
    if (amount === undefined) {
      showError('Enter the total salary as a whole number of won');
      return;
    }
    setBusy(true);
    try {
      await write.mutateAsync({
        path: `${basePath}/salary`,
        method: 'PUT',
        body: { year, totalSalary: amount },
      });
      showStatus(`Saved the ${year} total salary`);
      setSalary('');
      await refreshLedger(client, key);
    } catch (cause) {
      showError(cause, 'Could not save the salary');
    } finally {
      setBusy(false);
    }
  };

  const spending = data?.spending;
  const estimate = data?.estimate;
  return (
    <section aria-labelledby="card-deduction-title" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2" id="card-deduction-title">
            Year-end card deduction (estimate)
          </CardTitle>
          <CardDescription>
            Spending past {data?.rules.thresholdPercent ?? 25}% of your total salary is deducted:{' '}
            {data?.rules.creditPercent ?? 15}% of credit card spending and{' '}
            {data?.rules.debitCashPercent ?? 30}% of debit card and cash. This is only an estimate:
            markets, public transport, culture and child limits are not counted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Notice id="card-deduction-notice" notice={notice.notice} />
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="card-deduction-year">Year</Label>
            <select
              id="card-deduction-year"
              className={selectClass}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {[thisYear, thisYear - 1].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-deduction-salary">
                Total salary for {year}
                {data?.totalSalary != null ? ` (now ${formatWon(data.totalSalary)})` : ''}
              </Label>
              <Input
                id="card-deduction-salary"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 40,000,000"
                value={salary}
                onChange={(event) => setSalary(event.target.value)}
              />
            </div>
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? 'Saving…' : 'Save salary'}
            </Button>
          </form>
          {!data ? (
            notice.notice?.kind === 'error' ? null : (
              <p role="status" className="text-body-sm text-muted-foreground">
                Loading the estimate
              </p>
            )
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {[
                  ['Credit card', spending?.creditCard],
                  ['Debit card', spending?.debitCard],
                  ['Cash', spending?.cash],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between gap-4">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{formatWon(value as number)}</dd>
                  </div>
                ))}
              </dl>
              {spending && spending.unknown > 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  {formatWon(spending.unknown)} of expenses have no payment method and are left out.
                  Set it on each entry to include them.
                </p>
              ) : null}
              {estimate ? (
                <dl className="grid gap-x-6 gap-y-2 rounded-xl border p-4 sm:grid-cols-2">
                  <div className="flex justify-between gap-4">
                    <dt>Threshold</dt>
                    <dd className="tabular-nums">{formatWon(estimate.threshold)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{estimate.toThreshold > 0 ? 'Still to spend' : 'Past the threshold'}</dt>
                    <dd className="tabular-nums">
                      {formatWon(
                        estimate.toThreshold > 0 ? estimate.toThreshold : estimate.overThreshold,
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Estimated deduction</dt>
                    <dd className="font-medium tabular-nums">{formatWon(estimate.deduction)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Limit</dt>
                    <dd className="tabular-nums">{formatWon(estimate.limit)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-body-sm text-muted-foreground">
                  Enter the total salary to see the threshold and the estimate.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
