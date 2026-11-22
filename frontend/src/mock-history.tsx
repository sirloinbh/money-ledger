import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useCallback, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatDateTime, formatDecimal, formatWon, realDate, sharesOf } from './format';
import { type RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { mockKeys } from './mock-query';
import { useLoadError } from './query-reads';
import { formatMonthDay, formatPrice } from './quote-format';

// #54 Orders of the mock account, newest first, 50 at a time (decision 2026-11-10). Filtered by order day
// (KST) and security; the server does the filtering, this screen only formats what it returns.

type Order = {
  id: number;
  security: { id: number; symbol: string; name: string | null };
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  currency: 'KRW' | 'USD';
  priceDate: string;
  fxRate: string | null;
  fxDate: string | null;
  amountKrw: number;
  feeKrw: number;
  cashAfterKrw: number;
  createdAt: string;
};
type Page = {
  orders: Order[];
  hasMore: boolean;
  securities: { id: number; symbol: string; name: string | null }[];
};
type Filter = { from: string; to: string; securityId: string };

const emptyFilter: Filter = { from: '', to: '', securityId: '' };
const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';

/** The reason a filter cannot be sent, or null. Mirrors the server rules. */
function filterProblem(filter: Filter) {
  if ((filter.from && !realDate(filter.from)) || (filter.to && !realDate(filter.to))) {
    return 'Enter a valid date';
  }
  if (filter.from && filter.to && filter.from > filter.to) {
    return 'The start date cannot be after the end date';
  }
  return null;
}

const securityName = (security: { symbol: string; name: string | null }) =>
  security.name ?? security.symbol;

/**
 * The first page reloads with every mock change (`mockKey`, #213); a new first page (an order, new filters) starts
 * the list again from the newest, so the pages "Load more" added are dropped with it.
 */
export function MockHistory({ accountId }: { accountId: number }) {
  const [draft, setDraft] = useState<Filter>(emptyFilter);
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  const [invalid, setInvalid] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const notice = useNotice();
  const { error: showError, clear } = notice;
  const client = useQueryClient();

  const path = useCallback(
    (applied: Filter, before?: number) => {
      const params = new URLSearchParams();
      if (applied.from) params.set('from', applied.from);
      if (applied.to) params.set('to', applied.to);
      if (applied.securityId) params.set('securityId', applied.securityId);
      if (before !== undefined) params.set('before', String(before));
      const query = params.toString();
      return `/api/mock/accounts/${accountId}/orders${query ? `?${query}` : ''}`;
    },
    [accountId],
  );

  const firstPath = path(filter);
  const key = mockKeys.orders(accountId, firstPath);
  // While the first page of new filters loads, the one before stays on the screen (#197).
  const read = useQuery<Page, RequestError>({
    queryKey: key,
    queryFn: ({ signal }) => requestJson<Page>(firstPath, { signal }),
    placeholderData: keepPreviousData,
  });
  useLoadError(read.error, showError, 'Could not load the trades');
  // The first page last shown: it stays after the load for new filters failed, no longer "updating".
  const [lastShown, setLastShown] = useState(read.data);
  if (read.data !== undefined && read.data !== lastShown) {
    setLastShown(read.data);
    clear();
  }
  const first = read.data ?? lastShown;
  // The pages "Load more" added, for the first page they continue.
  const [more, setMore] = useState<{ after: Page; orders: Order[]; hasMore: boolean }>();
  const page =
    first && more?.after === first
      ? { ...first, orders: [...first.orders, ...more.orders], hasMore: more.hasMore }
      : first;

  // What is shown is about to be replaced (a load runs) or belongs to other filters (their load failed): it is
  // marked busy while its load runs and cannot be continued.
  const updating = page !== undefined && read.isFetching;
  const old =
    updating || (page !== undefined && (read.isPlaceholderData || read.data === undefined));

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const problem = filterProblem(draft);
    if (problem) {
      setInvalid(true);
      showError(problem);
      return;
    }
    setInvalid(false);
    // The same filters after their load failed: Apply tries them again.
    if (path(draft) === firstPath && read.isError) void read.refetch();
    setFilter({ ...draft });
  };

  const reset = () => {
    setInvalid(false);
    setDraft(emptyFilter);
    setFilter(emptyFilter);
  };

  const loadMore = async () => {
    const last = page?.orders.at(-1);
    if (!first || !page || !last || loadingMore || old) return;
    setLoadingMore(true);
    // Only continues the first page it was asked for: a new one (an order, new filters) starts the list again.
    const current = () => client.getQueryData(key) === first;
    try {
      const next = await requestJson<Page>(path(filter, last.id));
      if (!current()) return;
      setMore({
        after: first,
        orders: [...(more?.after === first ? more.orders : []), ...next.orders],
        hasMore: next.hasMore,
      });
    } catch (cause) {
      if (current()) showError(cause, 'Could not load more trades');
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = filter.from !== '' || filter.to !== '' || filter.securityId !== '';
  const field = {
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? 'mock-history-notice' : undefined,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2" id="mock-history-title">
          Trade history
        </CardTitle>
        <CardDescription>
          Shows 50 orders at a time, newest first. The date is the day of the order.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          aria-label="Trade history filters"
          onSubmit={apply}
          className="grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-4 sm:items-end"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="mock-history-from">Start date</Label>
            <Input
              id="mock-history-from"
              type="date"
              value={draft.from}
              {...field}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="mock-history-to">End date</Label>
            <Input
              id="mock-history-to"
              type="date"
              value={draft.to}
              {...field}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
            <Label htmlFor="mock-history-security">Security</Label>
            <select
              id="mock-history-security"
              className={selectClass}
              value={draft.securityId}
              onChange={(event) => setDraft({ ...draft, securityId: event.target.value })}
            >
              <option value="">All securities</option>
              {(page?.securities ?? []).map((security) => (
                <option key={security.id} value={String(security.id)}>
                  {securityName(security)} ({security.symbol})
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex gap-2 sm:col-span-1">
            <Button type="submit">Apply</Button>
            <Button type="button" variant="outline" onClick={reset}>
              Clear filters
            </Button>
          </div>
        </form>
        <Notice id="mock-history-notice" notice={notice.notice} />
        {updating ? (
          <p role="status" className="text-body-sm text-muted-foreground">
            Updating trade history
          </p>
        ) : null}
        {!page ? (
          notice.notice?.kind === 'error' ? null : (
            <p role="status" className="text-body-sm text-muted-foreground">
              Loading trade history
            </p>
          )
        ) : page.orders.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            {filtered ? 'No trades match the filters.' : 'No trades yet.'}
          </p>
        ) : (
          <>
            <ul
              aria-labelledby="mock-history-title"
              aria-busy={updating || undefined}
              className="flex flex-col divide-y rounded-xl border aria-busy:opacity-60"
            >
              {page.orders.map((order) => (
                <li key={order.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={
                        order.side === 'buy'
                          ? 'font-semibold'
                          : 'font-semibold text-muted-foreground'
                      }
                    >
                      {order.side === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                    <span className="font-medium">
                      {securityName(order.security)} {sharesOf(order.quantity)}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {formatDateTime(order.createdAt)}
                    </span>
                  </div>
                  <p className="text-body-sm text-muted-foreground tabular-nums">
                    {formatMonthDay(order.priceDate)} close{' '}
                    {formatPrice(order.price, order.currency)}
                    {order.fxRate && order.fxDate
                      ? ` · rate ₩${formatDecimal(order.fxRate)} (${formatMonthDay(order.fxDate)})`
                      : ''}
                  </p>
                  <p className="text-body-sm tabular-nums">
                    Fill amount {formatWon(order.amountKrw)} · fee {formatWon(order.feeKrw)} · cash
                    after order {formatWon(order.cashAfterKrw)}
                  </p>
                </li>
              ))}
            </ul>
            {page.hasMore ? (
              <Button
                type="button"
                variant="outline"
                aria-busy={loadingMore || undefined}
                aria-disabled={old || undefined}
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
