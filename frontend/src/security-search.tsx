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
type QuoteIssue = 'not_configured' | 'rate_limited' | 'fetch_failed' | 'not_found';
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
  none: 'No close received yet',
};

const title = (security: Security) => security.name ?? security.symbol;

type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; query: string; securities: Found[] };

/** `onOrdered`, when given, shows the mock order form in the detail and is called after each filled order. */
export function SecuritySearch({ onOrdered }: { onOrdered?: () => void } = {}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [invalid, setInvalid] = useState(false);
  const [selected, setSelected] = useState<number | undefined>(undefined);
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
          <CardDescription id="security-search-hint">
            Find Korean securities by name or code. Search US securities by ticker (e.g. AAPL).
          </CardDescription>
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
                aria-describedby={invalid ? 'security-search-notice' : 'security-search-hint'}
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
                    onClick={() => setSelected(found.id)}
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
      {selected === undefined ? null : (
        <SecurityDetail key={selected} id={selected} onLoaded={refreshRow} onOrdered={onOrdered} />
      )}
    </div>
  );
}

function SecurityDetail({
  id,
  onLoaded,
  onOrdered,
}: {
  id: number;
  onLoaded: (detail: Detail) => void;
  onOrdered?: () => void;
}) {
  const [detail, setDetail] = useState<Detail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    requestJson<Detail>(`/api/prices/securities/${id}`)
      .then((data) => {
        if (!current) return;
        setDetail(data);
        onLoaded(data);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(cause, 'Could not load the security quote'));
      });
    return () => {
      current = false;
    };
  }, [id, onLoaded]);

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
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
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
        {onOrdered ? (
          <MockOrder securityId={security.id} title={title(security)} onOrdered={onOrdered} />
        ) : null}
      </CardContent>
    </Card>
  );
}
