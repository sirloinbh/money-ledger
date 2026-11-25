import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { fixedCostsPath } from './fixed-costs-api';
import { formatWon } from './format';
import { refreshLedger } from './ledger-query';
import { apiKey, type ApiRequest, useApiMutation, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { useLoadError } from './query-reads';

// #291 Merchants that charge a similar amount every month and are not a fixed cost yet. The rule is the server's
// (`rule` in the answer): one charge in each of the last 3 complete months, within 10% of the median. One click
// registers a suggestion with the body the server prepared (starting next month), or dismisses it for good.

type Suggestion = {
  merchantKey: string;
  merchant: string;
  amount: number;
  variable: boolean;
  categoryName: string;
  dayOfMonth: number;
  entries: { id: number; date: string; amount: number }[];
  register: Record<string, unknown>;
};
type Recurring = {
  rule: { months: number; minMonths: number; tolerancePct: number };
  suggestions: Suggestion[];
};

const recurringPath = '/api/ledger/recurring';
// Under the ledger key, like every ledger read, so a change elsewhere in the ledger (an entry, a fixed cost) reloads it.
const recurringKey = apiKey('/api/ledger', 'recurring');

export function RecurringSuggestions() {
  const client = useQueryClient();
  const read = useApiQuery<Recurring>(recurringKey, recurringPath);
  const write = useApiMutation<unknown, ApiRequest>((request) => request);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  useLoadError(read.error, showError, 'Could not load the recurring payments');
  const suggestions = read.data?.suggestions ?? [];
  const rule = read.data?.rule;

  // A suggestion with nothing to show takes no room on the page.
  if (read.data && suggestions.length === 0 && !notice.notice) return null;

  const register = async (item: Suggestion) => {
    if (busy) return;
    setBusy(item.merchantKey);
    try {
      try {
        await write.mutateAsync({ path: fixedCostsPath, method: 'POST', body: item.register });
      } catch (cause) {
        showError(cause, 'Could not register the fixed cost');
        return;
      }
      // Saved now. Adding its entries is best effort: the app also adds them the next time it opens.
      await write.mutateAsync({ path: `${fixedCostsPath}/generate` }).catch(() => undefined);
      showStatus(`Registered ${item.merchant} as a fixed cost`);
      await refreshLedger(client);
    } finally {
      setBusy(undefined);
    }
  };

  const dismiss = async (item: Suggestion) => {
    if (busy) return;
    setBusy(item.merchantKey);
    try {
      try {
        await write.mutateAsync({
          path: `${recurringPath}/dismiss`,
          method: 'POST',
          body: { merchantKey: item.merchantKey },
        });
      } catch (cause) {
        showError(cause, 'Could not dismiss the suggestion');
        return;
      }
      showStatus(`${item.merchant} will not be suggested again`);
      await refreshLedger(client, recurringKey);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section aria-labelledby="recurring-title" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2" id="recurring-title">
            Recurring payments
          </CardTitle>
          <CardDescription>
            {rule
              ? `Merchants charged once a month in each of the last ${rule.months} months, with amounts within ${rule.tolerancePct}% of each other. Register one as a fixed cost, or dismiss it.`
              : 'Merchants you pay every month that are not fixed costs yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Notice id="recurring-notice" notice={notice.notice} />
          {!read.data ? (
            notice.notice?.kind === 'error' ? null : (
              <p role="status" className="text-body-sm text-muted-foreground">
                Loading the recurring payments
              </p>
            )
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((item) => (
                <li key={item.merchantKey} className="flex flex-col gap-2 rounded-xl border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{item.merchant}</p>
                    <p className="tabular-nums">
                      {formatWon(item.amount)}
                      {item.variable ? ' (varies)' : ''} on day {item.dayOfMonth}
                    </p>
                  </div>
                  <p className="text-body-sm text-muted-foreground">
                    {item.categoryName}:{' '}
                    {item.entries
                      .map((entry) => `${entry.date} ${formatWon(entry.amount)}`)
                      .join(', ')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy !== undefined}
                      aria-label={`Register ${item.merchant} as a fixed cost`}
                      onClick={() => void register(item)}
                    >
                      Register as fixed cost
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy !== undefined}
                      aria-label={`Dismiss ${item.merchant}`}
                      onClick={() => void dismiss(item)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
