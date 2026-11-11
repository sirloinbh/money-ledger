import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatDateTime, formatDecimal, formatWon, realDate } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
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

/** `refreshKey` changes after an order on the page, so the list starts again from the newest. */
export function MockHistory({ accountId, refreshKey }: { accountId: number; refreshKey: number }) {
  const [draft, setDraft] = useState<Filter>(emptyFilter);
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  // `request` is the load that gave this page: "Load more" only continues the list of the latest load.
  const [page, setPage] = useState<(Page & { request: number }) | undefined>(undefined);
  const [invalid, setInvalid] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the latest request may fill the list.
  const latest = useRef(0);
  const notice = useNotice();
  const { error: showError, clear } = notice;

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

  useEffect(() => {
    const request = ++latest.current;
    requestJson<Page>(path(filter))
      .then((loaded) => {
        if (latest.current !== request) return;
        clear();
        setPage({ ...loaded, request });
      })
      .catch((cause: unknown) => {
        if (latest.current === request) showError(cause, 'Could not load the trades');
      });
  }, [path, filter, refreshKey, showError, clear]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const problem = filterProblem(draft);
    if (problem) {
      setInvalid(true);
      showError(problem);
      return;
    }
    setInvalid(false);
    setFilter({ ...draft });
  };

  const reset = () => {
    setInvalid(false);
    setDraft(emptyFilter);
    setFilter(emptyFilter);
  };

  const more = async () => {
    const last = page?.orders.at(-1);
    // A new filter or an order on the page is loading: the shown page is about to be replaced, not continued.
    if (!page || !last || loadingMore || page.request !== latest.current) return;
    const { request } = page;
    setLoadingMore(true);
    try {
      const next = await requestJson<Page>(path(filter, last.id));
      if (latest.current !== request) return;
      setPage({ ...next, orders: [...page.orders, ...next.orders], request });
    } catch (cause) {
      if (latest.current === request) showError(cause, 'Could not load more trades');
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
              className="flex flex-col divide-y rounded-xl border"
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
                      {securityName(order.security)} {formatDecimal(order.quantity)} shares
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
                onClick={() => void more()}
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
