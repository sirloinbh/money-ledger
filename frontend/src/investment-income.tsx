import { type FormEvent, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { selectClass } from './entry-filters-state';
import { formatUsd, formatWon, realDate, withoutThousands, wonFromDigits } from './format';
import { serviceToday } from './lib/format';
import { type ApiRequest, useApiMutation, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { portfolioKeys } from './portfolio-query';

// #295 Dividends and interest per holding, realized gains of the year, and an estimate of the tax on overseas stock
// gains. Everything is computed on the server in SQL numeric (moving-average cost basis, user decision 2026-11-26);
// this screen only shows it and sends receipts. The tax is an estimate, never a tax return.

const incomePath = '/api/portfolio/income';

type Income = {
  id: number;
  assetId: number;
  assetName: string;
  kind: 'dividend' | 'interest';
  receivedOn: string;
  currency: 'KRW' | 'USD';
  amountForeign: string | null;
  fxRate: string | null;
  amountKrw: number;
  taxWithheldKrw: number;
  memo: string;
};
type Summary = {
  year: number;
  years: number[];
  income: Income[];
  incomeTotals: {
    dividendKrw: number;
    interestKrw: number;
    financialIncomeKrw: number;
    taxWithheldKrw: number;
    overLine: boolean;
  };
  gains: {
    overseasKrw: number;
    domesticKrw: number;
    sales: {
      tradeId: number;
      assetName: string;
      tradedOn: string;
      currency: 'KRW' | 'USD';
      realizedKrw: number;
    }[];
  };
  overseasTax: {
    gainKrw: number;
    deductionKrw: number;
    taxableKrw: number;
    percent: number;
    estimateKrw: number;
  };
};
type Asset = { id: number; name: string; type: string; currency: 'KRW' | 'USD' };

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);
const kindLabel = { dividend: 'Dividend', interest: 'Interest' } as const;

export function InvestmentIncome() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const key = portfolioKeys.income(year);
  const summary = useApiQuery<Summary>(key, `${incomePath}${year ? `?year=${year}` : ''}`);
  const assets = useApiQuery<{ assets: Asset[] }>(portfolioKeys.assets(), '/api/portfolio/assets');
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  const [adding, setAdding] = useState(false);
  const write = useApiMutation<unknown, ApiRequest>((request) => request, {
    invalidate: [portfolioKeys.incomeAll()],
  });
  const holdings = (assets.data?.assets ?? []).filter(
    (asset) => asset.type === 'stock' || asset.type === 'other',
  );

  const run = async (request: ApiRequest, done: string) => {
    try {
      await write.mutateAsync(request);
    } catch (cause) {
      showError(cause, 'Could not save the income');
      return false;
    }
    showStatus(done);
    return true;
  };

  const data = summary.data;
  return (
    <section aria-labelledby="income-title" className="flex flex-col gap-4">
      <h2 id="income-title">Dividends, interest and gains</h2>
      <Notice id="income-notice" notice={notice.notice} />
      {summary.isError && !summary.isFetching ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">Could not load the income.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void summary.refetch()}>
            Try again
          </Button>
        </div>
      ) : data === undefined ? (
        <p className="text-body-sm text-muted-foreground">Loading income</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:max-w-40">
            <Label htmlFor="income-year">Year</Label>
            <select
              id="income-year"
              className={selectClass}
              value={data.year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {data.years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Card>
            <CardHeader>
              <CardTitle asHeading="h3">Overseas stock tax estimate for {data.year}</CardTitle>
              <CardDescription>
                An estimate, not a tax return. Gains use the moving-average cost of the trades you
                recorded; check the amount on Hometax before filing in May.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-body-sm">
              <p>
                Realized gain on overseas stocks:{' '}
                <span className="tabular-nums">{signedWon(data.overseasTax.gainKrw)}</span>
              </p>
              <p>
                Basic deduction:{' '}
                <span className="tabular-nums">{formatWon(data.overseasTax.deductionKrw)}</span>
              </p>
              <p>
                Taxable amount:{' '}
                <span className="tabular-nums">{formatWon(data.overseasTax.taxableKrw)}</span>
              </p>
              <p className="font-medium">
                Estimated tax at {data.overseasTax.percent}%:{' '}
                <span className="tabular-nums">{formatWon(data.overseasTax.estimateKrw)}</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle asHeading="h3">Realized gains for {data.year}</CardTitle>
              <CardDescription>
                Overseas <span className="tabular-nums">{signedWon(data.gains.overseasKrw)}</span> ·
                Domestic <span className="tabular-nums">{signedWon(data.gains.domesticKrw)}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.gains.sales.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">No sales this year.</p>
              ) : (
                <ul aria-label="Sales" className="flex flex-col gap-1 text-body-sm">
                  {data.gains.sales.map((sale) => (
                    <li key={sale.tradeId} className="flex flex-wrap justify-between gap-2">
                      <span className="break-words">
                        {sale.tradedOn} {sale.assetName}
                      </span>
                      <span className="tabular-nums">{signedWon(sale.realizedKrw)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle asHeading="h3">Dividends and interest for {data.year}</CardTitle>
              <CardDescription>
                Dividends{' '}
                <span className="tabular-nums">{formatWon(data.incomeTotals.dividendKrw)}</span> ·
                Interest{' '}
                <span className="tabular-nums">{formatWon(data.incomeTotals.interestKrw)}</span> ·
                Tax withheld{' '}
                <span className="tabular-nums">{formatWon(data.incomeTotals.taxWithheldKrw)}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.incomeTotals.overLine ? (
                <p role="status" className="text-body-sm">
                  Dividends and interest add up to more than ₩20,000,000 this year. Above that line
                  they are added to your other income (comprehensive taxation).
                </p>
              ) : null}
              {data.income.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">Nothing recorded this year.</p>
              ) : (
                <ul aria-label="Dividends and interest" className="flex flex-col gap-2">
                  {data.income.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-body-sm"
                    >
                      <span className="break-words">
                        {item.receivedOn} {item.assetName} · {kindLabel[item.kind]}
                        {item.amountForeign
                          ? ` (${formatUsd(item.amountForeign)} at ₩${item.fxRate})`
                          : ''}
                        {item.memo ? ` · ${item.memo}` : ''}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatWon(item.amountKrw)}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${kindLabel[item.kind]} ${item.assetName} ${item.receivedOn}`}
                          disabled={write.isPending}
                          onClick={() =>
                            void run(
                              { path: `${incomePath}/${item.id}`, method: 'DELETE' },
                              'Income deleted',
                            )
                          }
                        >
                          Delete
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {adding ? (
                <IncomeForm
                  holdings={holdings}
                  onCancel={() => setAdding(false)}
                  onInvalid={(message) => showError(message)}
                  onSave={async (body) => {
                    const saved = await run({ path: incomePath, body }, 'Income recorded');
                    if (saved) setAdding(false);
                  }}
                />
              ) : (
                <div>
                  <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                    Add dividend or interest
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

type Draft = {
  assetId: string;
  kind: 'dividend' | 'interest';
  receivedOn: string;
  amount: string;
  fxRate: string;
  withheld: string;
  memo: string;
};

function IncomeForm({
  holdings,
  onCancel,
  onSave,
  onInvalid,
}: {
  holdings: Asset[];
  onCancel: () => void;
  onSave: (body: object) => Promise<void>;
  onInvalid: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    assetId: '',
    kind: 'dividend',
    receivedOn: serviceToday(),
    amount: '',
    fxRate: '',
    withheld: '0',
    memo: '',
  });
  const [saving, setSaving] = useState(false);
  const change = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const holding = holdings.find((asset) => String(asset.id) === draft.assetId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const refuse = (field: string, message: string) => {
      onInvalid(message);
      document.getElementById(`income-${field}`)?.focus();
    };
    if (!holding) return refuse('assetId', 'Choose a holding');
    if (!realDate(draft.receivedOn))
      return refuse('receivedOn', 'Enter a date between 1900 and 2100');
    if (draft.receivedOn > serviceToday())
      return refuse('receivedOn', 'Income dated after today cannot be recorded');
    const amount = withoutThousands(draft.amount);
    const withheld = wonFromDigits(withoutThousands(draft.withheld) || '0');
    if (withheld === undefined)
      return refuse('withheld', 'Enter the tax withheld as a whole number of won');
    const base = {
      assetId: holding.id,
      kind: draft.kind,
      receivedOn: draft.receivedOn,
      taxWithheldKrw: withheld,
      memo: draft.memo,
    };
    let body: object;
    if (holding.currency === 'KRW') {
      const amountKrw = wonFromDigits(amount);
      if (amountKrw === undefined) return refuse('amount', 'Enter the amount as whole won');
      body = { ...base, amountKrw };
    } else {
      const fxRate = withoutThousands(draft.fxRate);
      if (!/^\d{1,16}(\.\d{1,4})?$/.test(amount) || !/[1-9]/.test(amount))
        return refuse('amount', 'Enter the dollar amount above 0 with up to 4 decimal places');
      if (!/^\d{1,8}(\.\d{1,4})?$/.test(fxRate) || !/[1-9]/.test(fxRate))
        return refuse('fxRate', "Enter that day's exchange rate with up to 4 decimal places");
      body = { ...base, amountForeign: amount, fxRate };
    }
    setSaving(true);
    try {
      await onSave(body);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label="New dividend or interest"
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="income-assetId">Holding</Label>
          <select
            id="income-assetId"
            className={selectClass}
            value={draft.assetId}
            onChange={(event) => change({ assetId: event.target.value })}
          >
            <option value="">Choose</option>
            {holdings.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="income-kind">Type</Label>
          <select
            id="income-kind"
            className={selectClass}
            value={draft.kind}
            onChange={(event) => change({ kind: event.target.value as Draft['kind'] })}
          >
            <option value="dividend">Dividend</option>
            <option value="interest">Interest</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="income-receivedOn">Date received</Label>
          <Input
            id="income-receivedOn"
            placeholder="YYYY-MM-DD"
            autoComplete="off"
            value={draft.receivedOn}
            onChange={(event) => change({ receivedOn: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="income-amount">
            {holding?.currency === 'USD' ? 'Amount before tax (USD)' : 'Amount before tax (KRW)'}
          </Label>
          <Input
            id="income-amount"
            inputMode="decimal"
            autoComplete="off"
            value={draft.amount}
            onChange={(event) => change({ amount: event.target.value })}
          />
        </div>
        {holding?.currency === 'USD' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="income-fxRate">Exchange rate (KRW per USD)</Label>
            <Input
              id="income-fxRate"
              inputMode="decimal"
              autoComplete="off"
              value={draft.fxRate}
              onChange={(event) => change({ fxRate: event.target.value })}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="income-withheld">Tax withheld (KRW)</Label>
          <Input
            id="income-withheld"
            inputMode="numeric"
            autoComplete="off"
            value={draft.withheld}
            onChange={(event) => change({ withheld: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="income-memo">Note (optional)</Label>
          <Input
            id="income-memo"
            maxLength={100}
            value={draft.memo}
            onChange={(event) => change({ memo: event.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
