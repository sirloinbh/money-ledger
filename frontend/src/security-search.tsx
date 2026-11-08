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
import { formatClose, formatMonthDay, type Quote, quoteBasis } from './quote-format';

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

const marketNames: Record<string, string> = {
  KOSPI: '유가증권',
  KOSDAQ: '코스닥',
  KRX_ETF: '국내 ETF',
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  NYSE_ARCA: 'NYSE Arca',
};

const issueText: Record<QuoteIssue | 'none', string> = {
  not_configured: '시세 출처가 설정되지 않았습니다',
  rate_limited: '잠시 후 다시 시도하세요',
  fetch_failed: '시세를 받지 못했습니다. 잠시 후 다시 시도하세요',
  not_found: '시세 출처에서 찾을 수 없는 종목입니다',
  none: '아직 받은 종가가 없습니다',
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
      setSearch({ state: 'error', message: '검색어를 입력하세요' });
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
        setSearch({ state: 'error', message: errorText(cause, '종목을 검색하지 못했습니다') });
      }
    }
  };

  const notice: NoticeValue | undefined =
    search.state === 'error'
      ? { kind: 'error', text: search.message }
      : search.state === 'loading'
        ? { kind: 'status', text: '검색하는 중입니다' }
        : search.state === 'done'
          ? {
              kind: 'status',
              text:
                search.securities.length === 0
                  ? `"${search.query}" 검색 결과가 없습니다`
                  : `"${search.query}" 검색 결과 ${search.securities.length}개`,
            }
          : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2">종목 찾기</CardTitle>
          <CardDescription id="security-search-hint">
            국내 종목은 이름이나 종목코드로 찾습니다. 미국 종목은 티커로 검색하세요(예: AAPL).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            role="search"
            aria-label="종목 검색"
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex flex-col gap-2 sm:w-80">
              <Label htmlFor="security-query">종목 이름, 코드 또는 티커</Label>
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
              검색
            </Button>
          </form>
          <Notice id="security-search-notice" notice={notice} />
          {search.state === 'done' && search.securities.length > 0 ? (
            <ul aria-label="검색 결과" className="flex flex-col divide-y rounded-xl border">
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
                          {found.currency === 'USD' ? '열면 시세를 받습니다' : '시세 없음'}
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
        if (current) setError(errorText(cause, '종목 시세를 불러오지 못했습니다'));
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
          종목 시세
        </h2>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : (
          <p role="status" className="text-body-sm text-muted-foreground">
            시세를 불러오는 중입니다
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
          <span>{security.currency === 'KRW' ? '원화' : '달러'}</span>
          {security.active ? null : <Badge variant="warning">거래 중단</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
            <dt className="text-body-sm text-muted-foreground">현재가(종가)</dt>
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
                <span className="text-lg font-semibold">시세 없음</span>
                <span className="text-caption text-muted-foreground">
                  {issueText[quoteIssue ?? 'none']}
                </span>
              </dd>
            )}
          </div>
          {security.currency === 'USD' ? (
            <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
              <dt className="text-body-sm text-muted-foreground">원/달러 환율(매매기준율)</dt>
              {fx ? (
                <dd className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatDecimal(fx.fxRate)}원
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {fx.stale ? '환율 지연 · ' : ''}
                    {formatMonthDay(fx.rateDate)} 기준
                  </span>
                </dd>
              ) : (
                <dd className="text-lg font-semibold">환율 없음</dd>
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
