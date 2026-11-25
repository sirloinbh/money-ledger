import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { formatDecimal, formatWon, sharesOf } from './format';
import { requestJson } from './lib/api';
import { apiKey, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { mockKey, mockKeys } from './mock-query';
import { refreshReads, useLoadError } from './query-reads';

// #310 The morning question for each long hold: keep it or sell it. The server opens the questions at 08:30, sells
// at the best bid once the market is open, and keeps the position when there is no answer by 15:00. This card
// only shows today's questions and sends the answer; it shows nothing when there are none.

type Status = 'open' | 'kept' | 'sell_queued' | 'sold' | 'expired';
type Question = {
  id: number;
  positionId: number;
  questionDate: string;
  status: Status;
  security: { id: number; symbol: string; name: string | null };
  quantity: string;
  buy: { price: string; amountKrw: number };
};

const statusText: Record<Exclude<Status, 'open'>, string> = {
  kept: 'Kept',
  sell_queued: 'Sell waiting for the market',
  sold: 'Sold',
  expired: 'Sale not filled, kept',
};
const nameOf = (question: Question) => question.security.name ?? question.security.symbol;

export function MockKeepOrSell() {
  const client = useQueryClient();
  const accounts = useApiQuery<{ account: { id: number } | null }>(
    mockKeys.accounts(),
    '/api/mock/accounts',
  );
  const accountId = accounts.data?.account?.id;
  const read = useApiQuery<{ questions: Question[] }>(
    apiKey('/api/mock', 'accounts', accountId, 'next-day-questions'),
    `/api/mock/accounts/${accountId}/next-day-questions`,
    { enabled: accountId !== undefined },
  );
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  useLoadError(read.error, showError, 'Could not load the keep-or-sell questions');
  const [busy, setBusy] = useState(false);

  const questions = read.data?.questions ?? [];
  if (accountId === undefined || (questions.length === 0 && !notice.notice)) return null;

  const answer = async (question: Question, choice: 'keep' | 'sell') => {
    if (busy) return;
    setBusy(true);
    try {
      const { question: done } = await requestJson<{ question: Question }>(
        `/api/mock/positions/${question.positionId}/next-day`,
        { method: 'POST', body: { answer: choice, source: 'web' } },
      );
      showStatus(
        `${nameOf(question)}: ${done.status === 'sold' ? 'sold' : choice === 'keep' ? 'kept' : 'sell will fill when the market is open'}`,
      );
    } catch (cause) {
      showError(cause, 'Could not save the answer');
    } finally {
      setBusy(false);
      void refreshReads(client, mockKey);
    }
  };

  return (
    <Card aria-labelledby="mock-keep-or-sell-title">
      <CardHeader>
        <CardTitle asHeading="h2" id="mock-keep-or-sell-title">
          Keep or sell
        </CardTitle>
        <CardDescription>
          Asked each trading morning for every long hold. With no answer by 15:00 the position is
          kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Notice id="mock-keep-or-sell-notice" notice={notice.notice} />
        <ul aria-label="Keep or sell questions" className="flex flex-col gap-2">
          {questions.map((question) => (
            <li
              key={question.id}
              aria-label={nameOf(question)}
              className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <span className="text-body font-medium">{nameOf(question)}</span>
                <span className="text-body-sm text-muted-foreground">
                  {sharesOf(question.quantity)} bought at ₩{formatDecimal(question.buy.price)} (
                  {formatWon(question.buy.amountKrw)})
                </span>
              </div>
              {question.status === 'open' ? (
                <div role="group" aria-label={`${nameOf(question)} answer`} className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-disabled={busy || undefined}
                    onClick={() => void answer(question, 'keep')}
                  >
                    Keep
                  </Button>
                  <Button
                    type="button"
                    aria-disabled={busy || undefined}
                    onClick={() => void answer(question, 'sell')}
                  >
                    Sell
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary">{statusText[question.status]}</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
