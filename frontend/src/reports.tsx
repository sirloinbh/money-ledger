import { CircleAlert } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { formatWon } from './format';
import type { Health } from './health';
import { requestJson } from './lib/api';
import { Page } from './page';
import {
  makeReportsOnce,
  periodLabel,
  type Report,
  type ReportItem,
  reportsPath,
} from './reports-api';

// #62 The saved weekly and monthly spending reports, and one report. Opening a report clears its notice on the
// dashboard (PUT .../seen); reading the list does not.

/** undefined while loading; `failed` after an error, with `retry` to ask again. */
function useLoad<T>(load: () => Promise<T>) {
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

const Muted = ({ children }: { children: ReactNode }) => (
  <p className="text-body-sm text-muted-foreground">{children}</p>
);

function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Muted>Could not load {what}.</Muted>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

const shownName = (item: { name: string; hidden: boolean }) =>
  item.hidden ? `${item.name} (hidden)` : item.name;

// Waits for this open's reports to be made, so a period that just finished is listed.
const loadList = () =>
  makeReportsOnce().then(() => requestJson<{ reports: ReportItem[] }>(reportsPath));

export function ReportsPage({ health }: { health: Health }) {
  const { data, failed, retry } = useLoad(loadList);
  return (
    <Page
      title="Reports"
      description="Your spending each week (Sunday to Saturday) and each month, saved when the period ends"
      health={health}
    >
      {failed ? (
        <Failed what="the reports" onRetry={retry} />
      ) : data === undefined ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          Loading reports
        </p>
      ) : data.reports.length === 0 ? (
        <Muted>
          No reports yet. A report is saved once a week (Sunday to Saturday) or month with entries
          has ended.
        </Muted>
      ) : (
        <ul aria-label="Reports" className="flex flex-col gap-2">
          {data.reports.map((report) => (
            <li key={report.id}>
              <Link
                to={`/reports/${report.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border px-4 py-3 hover:bg-muted focus-visible:outline-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{periodLabel(report)}</span>
                  <Badge variant="outline">{report.period === 'week' ? 'Weekly' : 'Monthly'}</Badge>
                  {report.seen ? null : <Badge>New</Badge>}
                </span>
                <span className="text-body-sm tabular-nums">Spent {formatWon(report.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function changeText(report: Report) {
  const before = report.period === 'week' ? 'the week before' : 'the month before';
  if (report.change === 0) return `The same as ${before}`;
  return report.change > 0
    ? `${formatWon(report.change)} more than ${before}`
    : `${formatWon(-report.change)} less than ${before}`;
}

export function ReportPage({ health }: { health: Health }) {
  const { id } = useParams();
  const load = useCallback(
    () => requestJson<{ report: Report }>(`${reportsPath}/${id ?? ''}`),
    [id],
  );
  const { data, failed, retry } = useLoad(load);
  const report = data?.report;

  // Opened: its dashboard notice goes away. Not worth an error on screen if it fails; it is tried next time.
  useEffect(() => {
    if (report && !report.seen) {
      void requestJson(`${reportsPath}/${report.id}/seen`, { method: 'PUT' }).catch(
        () => undefined,
      );
    }
  }, [report]);

  return (
    <Page
      title="Spending report"
      description={report ? periodLabel(report) : 'A saved weekly or monthly report'}
      health={health}
    >
      <div>
        <Button asChild variant="outline" size="sm">
          <Link to="/reports">All reports</Link>
        </Button>
      </div>
      {failed ? (
        <Failed what="this report" onRetry={retry} />
      ) : report === undefined ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          Loading the report
        </p>
      ) : (
        <ReportBody report={report} />
      )}
    </Page>
  );
}

function ReportBody({ report }: { report: Report }) {
  const label = report.period === 'week' ? 'Previous week' : 'Previous month';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2">Spending</CardTitle>
          <CardDescription>
            {report.startDate} to {report.endDate}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body-sm text-muted-foreground">Spent</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatWon(report.total)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body-sm text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{formatWon(report.previousTotal)}</dd>
            </div>
          </dl>
          <p className="text-body-sm">{changeText(report)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asHeading="h2">Top categories</CardTitle>
          <CardDescription>The largest three, as a share of the spending</CardDescription>
        </CardHeader>
        <CardContent>
          {report.topCategories.length === 0 ? (
            <Muted>No spending in this period.</Muted>
          ) : (
            <ol className="flex flex-col gap-2">
              {report.topCategories.map((category, index) => (
                <li
                  key={category.categoryId ?? 'none'}
                  className="flex items-baseline justify-between gap-3 text-body-sm"
                >
                  <span className="min-w-0 break-words">
                    {index + 1}. {shownName(category)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatWon(category.amount)}{' '}
                    <span className="text-muted-foreground">({category.share}%)</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {report.overspending === null ? null : (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle asHeading="h2">Overspending</CardTitle>
            <CardDescription>
              Categories that reached or passed their budget. Spending equal to the budget counts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.overspending.length === 0 ? (
              <Muted>No category reached its budget.</Muted>
            ) : (
              <ul aria-label="Overspending" className="flex flex-col gap-2">
                {report.overspending.map((item) => (
                  <li key={item.categoryId} className="flex items-start gap-2 text-body-sm">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p className="min-w-0 break-words">
                      <span className="font-medium">{shownName(item)}</span>
                      {': '}
                      {item.status === 'over'
                        ? `spent ${formatWon(item.spent)} of a ${formatWon(item.budget)} budget, ${formatWon(item.over)} more (${item.percent}%)`
                        : `spent ${formatWon(item.spent)}, all of the ${formatWon(item.budget)} budget (${item.percent}%)`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-caption text-muted-foreground lg:col-span-2">
        Saved on {report.madeOn}. Entries changed after that are not reflected here; the ledger
        always shows the current numbers.
      </p>
    </div>
  );
}
