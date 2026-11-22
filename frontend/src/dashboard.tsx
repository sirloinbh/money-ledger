import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { formatWon, serviceToday, signedPercent } from './format';
import type { Health } from './health';
import { requestJson } from './lib/api';
import { netWorthPath, saveTodayOnce, type Snapshot } from './net-worth';
import { Page } from './page';
import { makeReportsOnce, periodLabel, type ReportItem, reportsPath } from './reports-api';
import { monthLabel } from './trend-series';

// #55 The first screen: this month's ledger, the latest net worth, and the mock account at a glance. Each card
// asks the same API as its own page, so the values match it, and loads on its own, so one failure leaves the
// others shown. Mock money is shown apart from real assets and is not part of the net worth.
// #62 New spending reports are announced above the cards until they are opened.

type Summary = { income: number; expense: number; balance: number };
type NetWorth = { snapshots: Snapshot[] };
type MockAccount = { account: { id: number } | null };
type MockSummary = {
  summary: {
    cashKrw: number;
    totalKrw: number | null;
    profitKrw: number | null;
    returnPct: string | null;
  };
};
type MockState = { open: false } | ({ open: true } & MockSummary);

/** One card's data: undefined while loading; `failed` after an error, with `retry` to ask again. */
function useCardData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setFailed(false);
    load().then(
      (value) => {
        if (current) setData(value);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [load, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, failed, retry };
}

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);

// The loaders do not change, so each card loads once (and again on retry).
// Waits for today's save when the app opens, like the net worth card on the portfolio page.
// Only the latest saved day: the card shows no history (#195).
const loadNetWorth = () =>
  saveTodayOnce().then(() => requestJson<NetWorth>(`${netWorthPath}?latest=true`));
// Waits for this open's reports to be made, so a period that just finished is announced.
const loadReports = () =>
  makeReportsOnce().then(() => requestJson<{ reports: ReportItem[] }>(reportsPath));
const loadMock = async (): Promise<MockState> => {
  const { account } = await requestJson<MockAccount>('/api/mock/accounts');
  if (!account) return { open: false };
  const data = await requestJson<MockSummary>(`/api/mock/accounts/${account.id}/holdings`);
  return { open: true, summary: data.summary };
};

export function DashboardPage({ health }: { health: Health }) {
  return (
    <Page
      title="Dashboard"
      description="This month's income and spending, your net worth, and mock trading at a glance"
      health={health}
    >
      <NewReports />
      <div className="grid gap-4 lg:grid-cols-3">
        <LedgerCard />
        <NetWorthCard />
        <MockCard />
      </div>
    </Page>
  );
}

/** Reports not opened yet, as links; nothing at all while loading, on failure, or when there are none. */
function NewReports() {
  const { data } = useCardData(loadReports);
  const fresh = data?.reports.filter((report) => !report.seen) ?? [];
  if (fresh.length === 0) return null;
  return (
    <section
      aria-labelledby="new-reports-title"
      className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3"
    >
      <h2 id="new-reports-title" className="text-body font-semibold">
        {fresh.length === 1 ? 'New spending report' : 'New spending reports'}
      </h2>
      <ul className="flex flex-col gap-1">
        {fresh.map((report) => (
          <li key={report.id} className="text-body-sm">
            <Link to={`/reports/${report.id}`} className="underline underline-offset-4">
              {periodLabel(report)}
            </Link>
            <span className="text-muted-foreground"> · spent {formatWon(report.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SummaryCard({
  id,
  title,
  description,
  to,
  linkText,
  failed,
  onRetry,
  children,
}: {
  id: string;
  title: string;
  description: string;
  to: string;
  linkText: string;
  failed: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="region">
      <CardHeader>
        <CardTitle id={`${id}-title`} asHeading="h2">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body-sm text-muted-foreground">Could not load this card.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Retry loading ${title}`}
              onClick={onRetry}
            >
              Try again
            </Button>
          </div>
        ) : (
          children
        )}
        <div className="mt-auto">
          <Button asChild variant="outline" size="sm">
            <Link to={to}>{linkText}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Values({ items }: { items: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-body-sm text-muted-foreground">{label}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const Loading = () => (
  <p role="status" className="text-body-sm text-muted-foreground">
    Loading
  </p>
);
const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-body-sm text-muted-foreground">{children}</p>
);

function LedgerCard() {
  // Taken once, so the title, the link, and the totals are the same month even if the page stays open past
  // midnight at the end of a month.
  const [month] = useState(() => serviceToday().slice(0, 7));
  const load = useCallback(
    () => requestJson<Summary>(`/api/ledger/summary?month=${month}`),
    [month],
  );
  const { data, failed, retry } = useCardData(load);
  return (
    <SummaryCard
      id="dashboard-ledger"
      title="This month"
      description={`Income and spending in ${monthLabel(month)}`}
      to={`/ledger?month=${month}`}
      linkText="Open the ledger"
      failed={failed}
      onRetry={retry}
    >
      {data === undefined ? (
        <Loading />
      ) : data.income === 0 && data.expense === 0 ? (
        <Empty>No income or spending recorded this month yet.</Empty>
      ) : (
        <Values
          items={[
            ['Income', formatWon(data.income)],
            ['Expense', formatWon(data.expense)],
            ['Balance', formatWon(data.balance)],
          ]}
        />
      )}
    </SummaryCard>
  );
}

function NetWorthCard() {
  const { data, failed, retry } = useCardData(loadNetWorth);
  const latest = data?.snapshots.at(-1);
  return (
    <SummaryCard
      id="dashboard-net-worth"
      title="Net worth"
      description={latest ? `Saved on ${latest.date}` : 'Real assets minus liabilities'}
      to="/portfolio"
      linkText="Open the portfolio"
      failed={failed}
      onRetry={retry}
    >
      {data === undefined ? (
        <Loading />
      ) : !latest ? (
        <Empty>No net worth saved yet. Add your assets on the portfolio page.</Empty>
      ) : (
        <>
          <Values
            items={[
              ['Net worth', formatWon(latest.netKrw)],
              ['Assets', formatWon(latest.assetsKrw)],
              ['Liabilities', formatWon(latest.debtsKrw)],
            ]}
          />
          {latest.uncounted > 0 ? (
            <p className="text-caption text-muted-foreground">
              {latest.uncounted === 1
                ? '1 item without a value (no price, exchange rate, or valuation) is left out.'
                : `${latest.uncounted} items without a value (no price, exchange rate, or valuation) are left out.`}
            </p>
          ) : null}
        </>
      )}
    </SummaryCard>
  );
}

function MockCard() {
  const { data, failed, retry } = useCardData(loadMock);
  return (
    <SummaryCard
      id="dashboard-mock"
      title="Mock trading"
      description="Practice money, not part of your net worth"
      to="/mock-trading"
      linkText="Open mock trading"
      failed={failed}
      onRetry={retry}
    >
      {data === undefined ? (
        <Loading />
      ) : !data.open ? (
        <Empty>No mock account yet. Open one on the mock trading page.</Empty>
      ) : (
        <Values
          items={[
            [
              'Total assets',
              data.summary.totalKrw === null ? '-' : formatWon(data.summary.totalKrw),
            ],
            [
              'Gain/loss',
              data.summary.profitKrw === null ? '-' : signedWon(data.summary.profitKrw),
            ],
            [
              'Return',
              data.summary.returnPct === null ? '-' : signedPercent(data.summary.returnPct),
            ],
          ]}
        />
      )}
    </SummaryCard>
  );
}
