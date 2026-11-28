import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatDecimal } from './format';
import { requestJson } from './lib/api';
import { errorText, type NoticeValue } from './lib/use-notice';
import { MockOrder } from './mock-order';
import { formatClose, formatMonthDay, marketNames, type Quote, quoteBasis } from './quote-format';

// #51 Security search and quote detail on the shared price API (/api/prices). Korean securities are found by
// name or code, US ones by ticker; a US name is saved once its detail is opened (2026-11-08 decision).
// Prices are the stored daily close, so the screen always shows the date the close is from.

type Security = {
  id: number;
  market: string;
  symbol: string;
  name: string | null;
  kind: 'stock' | 'etf';
  active: boolean;
  currency: 'KRW' | 'USD';
};
type Found = Security & { quote: Quote | null };
type QuoteIssue =
  'not_configured' | 'rate_limited' | 'fetch_failed' | 'not_found' | 'tracking_full';
type Detail = {
  security: Security;
  quote: Quote | null;
  quoteIssue: QuoteIssue | null;
  fx: { fxRate: string; rateDate: string; stale: boolean } | null;
};

const issueText: Record<QuoteIssue | 'none', string> = {
  not_configured: 'No quote source is configured',
  rate_limited: 'Try again in a moment',
  fetch_failed: 'Could not get the quote. Try again in a moment',
  not_found: 'This security was not found in the quote source',
  tracking_full:
    'Too many US securities are followed right now, so no quote was fetched. Try again in a few days',
  none: 'No close received yet',
};

const title = (security: Security) => security.name ?? security.symbol;

type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; query: string; securities: Found[] };

/** `orders` shows the mock order form in the detail (the Mock trading page). */
export function SecuritySearch({ orders = false }: { orders?: boolean } = {}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [invalid, setInvalid] = useState(false);
  // `opened` counts reopenings of the selected result: clicking it again after its detail failed to load
  // opens the detail afresh (#197). A detail that loaded stays as it is, with any order being typed.
  const [selection, setSelection] = useState<
    { id: number; opened: number; failed: boolean } | undefined
  >(undefined);
  const selected = selection?.id;
  const detailFailed = useCallback((id: number) => {
    setSelection((current) => (current?.id === id ? { ...current, failed: true } : current));
  }, []);
  // Only the latest search may change the list, whatever order the answers come back in.
  const latest = useRef(0);

  // Opening a US security can fetch its name and close; the result row shows them without a new search.
  const refreshRow = useCallback((detail: Detail) => {
    setSearch((current) =>
      current.state === 'done'
        ? {
            ...current,
            securities: current.securities.map((found) =>
              found.id === detail.security.id
                ? { ...found, ...detail.security, quote: detail.quote ?? found.quote }
                : found,
            ),
          }
        : current,
    );
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      setInvalid(true);
      setSearch({ state: 'error', message: 'Enter a search term' });
      return;
    }
    setInvalid(false);
    const id = ++latest.current;
    setSearch({ state: 'loading' });
    try {
      const data = await requestJson<{ securities: Found[] }>(
        `/api/prices/securities?q=${encodeURIComponent(q)}`,
      );
      if (id === latest.current)
        setSearch({ state: 'done', query: q, securities: data.securities });
    } catch (cause) {
      if (id === latest.current) {
        setSearch({ state: 'error', message: errorText(cause, 'Could not search securities') });
      }
    }
  };

  const notice: NoticeValue | undefined =
    search.state === 'error'
      ? { kind: 'error', text: search.message }
      : search.state === 'loading'
        ? { kind: 'status', text: 'Searching' }
        : search.state === 'done'
          ? {
              kind: 'status',
              text:
                search.securities.length === 0
                  ? `No results for "${search.query}"`
                  : `${search.securities.length} ${search.securities.length === 1 ? 'result' : 'results'} for "${search.query}"`,
            }
          : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2">Find a security</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            role="search"
            aria-label="Security search"
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex flex-col gap-2 sm:w-80">
              <Label htmlFor="security-query">Security name, code, or ticker</Label>
              <Input
                id="security-query"
                type="search"
                autoComplete="off"
                maxLength={40}
                value={query}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? 'security-search-notice' : undefined}
                onChange={(event) => {
                  if (invalid) setInvalid(false);
                  setQuery(event.target.value);
                }}
              />
            </div>
            <Button type="submit" aria-busy={search.state === 'loading' || undefined}>
              Search
            </Button>
          </form>
          <Notice id="security-search-notice" notice={notice} />
          {search.state === 'done' && search.securities.length > 0 ? (
            <ul aria-label="Search results" className="flex flex-col divide-y rounded-xl border">
              {search.securities.map((found) => (
                <li key={found.id}>
                  <button
                    type="button"
                    aria-current={selected === found.id || undefined}
                    onClick={() =>
                      setSelection((current) =>
                        current?.id !== found.id
                          ? { id: found.id, opened: 0, failed: false }
                          : current.failed
                            ? { id: found.id, opened: current.opened + 1, failed: false }
                            : current,
                      )
                    }
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current]:bg-accent"
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-body font-medium break-words">{title(found)}</span>
                      <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                        {/* Without a name the symbol is already the title. */}
                        {found.name ? <span className="tabular-nums">{found.symbol}</span> : null}
                        <Badge variant="outline">{marketNames[found.market] ?? found.market}</Badge>
                        {found.kind === 'etf' ? <Badge variant="secondary">ETF</Badge> : null}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1 text-right">
                      {found.quote ? (
                        <>
                          <span className="text-body font-semibold tabular-nums">
                            {formatClose(found.quote)}
                          </span>
                          <span className="text-caption text-muted-foreground">
                            {quoteBasis(found.quote)}
                          </span>
                        </>
                      ) : (
                        <span className="text-body-sm text-muted-foreground">
                          {found.currency === 'USD' ? 'Open to get a quote' : 'No quote'}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      {selection === undefined ? null : (
        <SecurityDetail
          key={`${selection.id}-${selection.opened}`}
          id={selection.id}
          onLoaded={refreshRow}
          onFailed={detailFailed}
          orders={orders}
        />
      )}
    </div>
  );
}

function SecurityDetail({
  id,
  onLoaded,
  onFailed,
  orders,
}: {
  id: number;
  onLoaded: (detail: Detail) => void;
  onFailed: (id: number) => void;
  orders: boolean;
}) {
  const [detail, setDetail] = useState<Detail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Bumped by "Try again" after a failed load, which runs the load again (#197).
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    // #98 Opening is a POST: it may fetch the quote now and follow the security for 30 days, which a
    // plain read never does.
    requestJson<Detail>(`/api/prices/securities/${id}/view`, { method: 'POST' })
      .then((data) => {
        if (!current) return;
        setDetail(data);
        onLoaded(data);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setError(errorText(cause, 'Could not load the security quote'));
        onFailed(id);
      });
    return () => {
      current = false;
    };
  }, [id, onLoaded, onFailed, attempt]);

  // The detail replaces nothing on the screen, so focus moves to it once it is there.
  useEffect(() => {
    if (detail || error) heading.current?.focus();
  }, [detail, error]);

  if (!detail) {
    return (
      <section aria-labelledby="security-detail-title" className="flex flex-col gap-2">
        <h2 id="security-detail-title" ref={heading} tabIndex={-1} className="outline-none">
          Security quote
        </h2>
        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(undefined);
                setAttempt((count) => count + 1);
                // The button goes away while loading, so focus stays in the section on its heading.
                heading.current?.focus();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="text-body-sm text-muted-foreground">
            Loading the quote
          </p>
        )}
      </section>
    );
  }

  const { security, quote, quoteIssue, fx } = detail;
  return (
    <Card>
      <CardHeader>
        <CardTitle
          asHeading="h2"
          id="security-detail-title"
          ref={heading}
          tabIndex={-1}
          className="break-words outline-none"
        >
          {title(security)}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">{security.symbol}</span>
          <Badge variant="outline">{marketNames[security.market] ?? security.market}</Badge>
          {security.kind === 'etf' ? <Badge variant="secondary">ETF</Badge> : null}
          <span>{security.currency === 'KRW' ? 'KRW' : 'USD'}</span>
          {security.active ? null : <Badge variant="warning">Trading halted</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
            <dt className="text-body-sm text-muted-foreground">Current price (close)</dt>
            {quote ? (
              <dd className="flex flex-col gap-1">
                <span className="text-lg font-semibold tabular-nums">{formatClose(quote)}</span>
                <span
                  className={
                    quote.stale
                      ? 'text-caption font-medium text-foreground'
                      : 'text-caption text-muted-foreground'
                  }
                >
                  {quoteBasis(quote)}
                </span>
                {quoteIssue === 'tracking_full' ? (
                  <span className="text-caption text-muted-foreground">
                    {issueText.tracking_full}
                  </span>
                ) : null}
              </dd>
            ) : (
              <dd className="flex flex-col gap-1">
                <span className="text-lg font-semibold">No quote</span>
                <span className="text-caption text-muted-foreground">
                  {issueText[quoteIssue ?? 'none']}
                </span>
              </dd>
            )}
          </div>
          {security.currency === 'USD' ? (
            <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
              <dt className="text-body-sm text-muted-foreground">
                KRW/USD exchange rate (base rate)
              </dt>
              {fx ? (
                <dd className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tabular-nums">
                    ₩{formatDecimal(fx.fxRate)}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {fx.stale ? 'Rate delayed · ' : ''}
                    as of {formatMonthDay(fx.rateDate)}
                  </span>
                </dd>
              ) : (
                <dd className="text-lg font-semibold">No exchange rate</dd>
              )}
            </div>
          ) : null}
        </dl>
        {orders ? (
          <MockOrder
            securityId={security.id}
            title={title(security)}
            currency={security.currency}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
