import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { Textarea } from './components/ui/textarea';
import { formatDateTime, formatWon, sharesOf } from './format';
import { type RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { mockKey, mockKeys } from './mock-query';
import { refreshReads, useLoadError } from './query-reads';

// #293 Trade journal: every order with the reason written when it was placed, a later review note, and the
// result so far. The server works out the result (SQL numeric); this screen only shows it and saves notes.

export const noteLimit = 1000;

type Entry = {
  id: number;
  security: { id: number; symbol: string; name: string | null };
  side: 'buy' | 'sell';
  quantity: string;
  amountKrw: number;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  result: { kind: 'realized' | 'current'; gainKrw: number } | null;
};
type Page = { entries: Entry[]; hasMore: boolean };

const securityName = (security: { symbol: string; name: string | null }) =>
  security.name ?? security.symbol;

/** "+₩20,000" or "-₩1,234": the sign is part of the text, so the result is not shown by colour alone. */
function signedWon(amount: number) {
  return amount > 0 ? `+${formatWon(amount)}` : formatWon(amount);
}

function resultText(result: Entry['result'], side: Entry['side']) {
  if (!result) {
    return side === 'sell' ? 'No result for this sale yet' : 'No result yet (no saved close)';
  }
  return result.kind === 'realized'
    ? `Realized ${signedWon(result.gainKrw)}`
    : `If sold at the latest close ${signedWon(result.gainKrw)}`;
}

function NoteEditor({
  accountId,
  entry,
  onDone,
}: {
  accountId: number;
  entry: Entry;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [note, setNote] = useState(entry.note ?? '');
  const [review, setReview] = useState(entry.reviewNote ?? '');
  const [busy, setBusy] = useState(false);
  const notice = useNotice();
  const id = `journal-${entry.id}`;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (note.length > noteLimit || review.length > noteLimit) {
      notice.error(`Keep each note to ${noteLimit.toLocaleString('en-US')} characters or fewer`);
      return;
    }
    setBusy(true);
    try {
      await requestJson(`/api/mock/accounts/${accountId}/orders/${entry.id}/notes`, {
        method: 'PATCH',
        body: { note, reviewNote: review },
      });
      onDone();
      void refreshReads(client, mockKey);
    } catch (cause) {
      notice.error(cause, 'Could not save the notes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={`Notes for order ${entry.id}`}
      onSubmit={(event) => void save(event)}
      className="flex flex-col gap-3 pt-2"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-note`}>Why I placed this order</Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          limit={noteLimit}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-review`}>Looking back</Label>
        <Textarea
          id={`${id}-review`}
          value={review}
          limit={noteLimit}
          onChange={(event) => setReview(event.target.value)}
        />
      </div>
      <Notice id={`${id}-notice`} notice={notice.notice} />
      <div className="flex gap-2">
        <Button type="submit" aria-busy={busy || undefined}>
          {busy ? 'Saving…' : 'Save notes'}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Reloads with every mock change (`mockKey`); "Load more" continues from the oldest entry shown. */
export function MockJournal({ accountId }: { accountId: number }) {
  const [editing, setEditing] = useState<number>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [more, setMore] = useState<{ after: Page; entries: Entry[]; hasMore: boolean }>();
  const notice = useNotice();
  const { error: showError, clear } = notice;
  const path = `/api/mock/accounts/${accountId}/orders/journal`;
  const read = useQuery<Page, RequestError>({
    queryKey: mockKeys.journal(accountId),
    queryFn: ({ signal }) => requestJson<Page>(path, { signal }),
  });
  useLoadError(read.error, showError, 'Could not load the journal');
  const first = read.data;
  const page =
    first && more?.after === first
      ? { entries: [...first.entries, ...more.entries], hasMore: more.hasMore }
      : first;

  const loadMore = async () => {
    const last = page?.entries.at(-1);
    if (!first || !last || loadingMore) return;
    setLoadingMore(true);
    clear();
    try {
      const next = await requestJson<Page>(`${path}?before=${last.id}`);
      setMore({
        after: first,
        entries: [...(more?.after === first ? more.entries : []), ...next.entries],
        hasMore: next.hasMore,
      });
    } catch (cause) {
      showError(cause, 'Could not load more of the journal');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2" id="mock-journal-title">
          Trade journal
        </CardTitle>
        <CardDescription>
          The reason behind each order next to how it turned out. Add a note to look back later.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Notice id="mock-journal-notice" notice={notice.notice} />
        {!page ? (
          notice.notice?.kind === 'error' ? null : (
            <p role="status" className="text-body-sm text-muted-foreground">
              Loading the journal
            </p>
          )
        ) : page.entries.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No trades yet.</p>
        ) : (
          <>
            <ul
              aria-labelledby="mock-journal-title"
              className="flex flex-col divide-y rounded-xl border"
            >
              {page.entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{entry.side === 'buy' ? 'Buy' : 'Sell'}</span>
                    <span className="font-medium">
                      {securityName(entry.security)} {sharesOf(entry.quantity)}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                  <p className="text-body-sm tabular-nums">
                    {formatWon(entry.amountKrw)} · {resultText(entry.result, entry.side)}
                  </p>
                  {editing === entry.id ? (
                    <NoteEditor
                      accountId={accountId}
                      entry={entry}
                      onDone={() => setEditing(undefined)}
                    />
                  ) : (
                    <>
                      <p className="text-body-sm whitespace-pre-wrap">
                        <span className="text-muted-foreground">Why: </span>
                        {entry.note ?? <span className="text-muted-foreground">No note</span>}
                      </p>
                      {entry.reviewNote ? (
                        <p className="text-body-sm whitespace-pre-wrap">
                          <span className="text-muted-foreground">Looking back: </span>
                          {entry.reviewNote}
                        </p>
                      ) : null}
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Edit notes for ${entry.side === 'buy' ? 'buy' : 'sell'} of ${securityName(entry.security)} on ${formatDateTime(entry.createdAt)}`}
                          onClick={() => setEditing(entry.id)}
                        >
                          Edit notes
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {page.hasMore ? (
              <Button
                type="button"
                variant="outline"
                aria-busy={loadingMore || undefined}
                onClick={() => void loadMore()}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
