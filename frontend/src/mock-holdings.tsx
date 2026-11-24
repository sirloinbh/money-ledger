import { useEffect, useRef, useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Notice } from './components/ui/notice';
import { formatDecimal, formatWon, sharesOf, signedPercent } from './format';
import { useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { MockOrder } from './mock-order';
import { mockKeys } from './mock-query';
import { useLoadError } from './query-reads';
import { formatMonthDay, formatPrice, quoteBasis } from './quote-format';

// #53 What the mock account holds and how it has done. Every amount and rate comes from the server
// (valued at the latest stored close and rate); this screen only formats them.

type Holding = {
  security: {
    id: number;
    symbol: string;
    name: string | null;
    currency: 'KRW' | 'USD';
    active: boolean;
  };
  quantity: string;
  price: string | null;
  priceDate: string | null;
  priceStale: boolean;
  fxRate: string | null;
  fxDate: string | null;
  costKrw: number;
  valueKrw: number | null;
  profitKrw: number | null;
  returnPct: string | null;
};
type Data = {
  summary: {
    initialCashKrw: number;
    cashKrw: number;
    costKrw: number;
    valueKrw: number | null;
    totalKrw: number | null;
    profitKrw: number | null;
    returnPct: string | null;
  };
  holdings: Holding[];
};

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);

const profitText = (profit: number | null, pct: string | null) =>
  profit === null ? '-' : `${signedWon(profit)}${pct === null ? '' : ` (${signedPercent(pct)})`}`;

const heldTitle = (held: Holding) => held.security.name ?? held.security.symbol;

/**
 * Values reload with every mock change (`mockKey`, #213), so an order anywhere on the page shows here. Each holding
 * opens the order form too: a suspended security (#97) is not found by search, so this is the way to sell it.
 */
export function MockHoldings({ accountId }: { accountId: number }) {
  // Keyed by account, so values of an account that was reset in the meantime are never shown for the new one.
  const read = useApiQuery<Data>(
    mockKeys.holdings(accountId),
    `/api/mock/accounts/${accountId}/holdings`,
  );
  const loaded = read.data;
  // The holding whose order form is open.
  const [ordering, setOrdering] = useState<{ id: number; title: string }>();
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  useLoadError(read.error, showError, 'Could not load the holdings');

  // The heading takes the focus when the open form goes away with its sold-out holding (#279).
  const title = useRef<HTMLHeadingElement>(null);
  const [soldOut, setSoldOut] = useState(false);
  useEffect(() => {
    if (soldOut) {
      title.current?.focus();
      setSoldOut(false);
    }
  }, [soldOut]);

  // When values come back: a holding with the open form that was sold out takes its form with it, so the
  // result is said here.
  const [seen, setSeen] = useState(loaded);
  if (loaded !== seen) {
    setSeen(loaded);
    if (loaded) {
      if (ordering && !loaded.holdings.some((held) => held.security.id === ordering.id)) {
        setOrdering(undefined);
        setSoldOut(true);
        showStatus(`Sold all your ${ordering.title}`);
      } else clear();
    }
  }

  return (
    <section aria-labelledby="mock-holdings-title" className="flex flex-col gap-3">
      <h3
        id="mock-holdings-title"
        ref={title}
        tabIndex={-1}
        className="text-body font-semibold outline-none"
      >
        Holdings and returns
      </h3>
      <Notice id="mock-holdings-notice" notice={notice.notice} />
      {!loaded ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">Loading holdings</p>
        )
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                'Total assets',
                loaded.summary.totalKrw === null ? '-' : formatWon(loaded.summary.totalKrw),
              ],
              [
                'Valuation',
                loaded.summary.valueKrw === null ? '-' : formatWon(loaded.summary.valueKrw),
              ],
              ['Account gain/loss', profitText(loaded.summary.profitKrw, null)],
              [
                'Return',
                loaded.summary.returnPct === null ? '-' : signedPercent(loaded.summary.returnPct),
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 rounded-xl border px-4 py-3">
                <dt className="text-body-sm text-muted-foreground">{label}</dt>
                <dd className="font-semibold break-words tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-muted-foreground">
            Total assets are the cash balance plus the valuation, and the return is measured against
            the starting amount. The valuation uses the latest saved close and exchange rate.
            {loaded.summary.totalKrw === null
              ? ' Some holdings have no quote or exchange rate, so total assets could not be calculated.'
              : ''}
          </p>
          {loaded.holdings.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">
              No holdings. Find a security below and place a mock order.
            </p>
          ) : (
            <ul
              aria-labelledby="mock-holdings-title"
              className="flex flex-col divide-y rounded-xl border"
            >
              {loaded.holdings.map((held) => (
                <li key={held.security.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{heldTitle(held)}</span>
                    <span className="text-body-sm text-muted-foreground">
                      {held.security.symbol}
                    </span>
                    {held.security.active ? null : <Badge variant="warning">Trading halted</Badge>}
                  </div>
                  <p className="text-body-sm text-muted-foreground tabular-nums">
                    {sharesOf(held.quantity)}
                    {held.price !== null && held.priceDate !== null
                      ? ` · ${quoteBasis({ tradeDate: held.priceDate, stale: held.priceStale })} ${formatPrice(held.price, held.security.currency)}`
                      : ' · No close'}
                    {held.fxRate !== null && held.fxDate !== null
                      ? ` · rate ₩${formatDecimal(held.fxRate)} (${formatMonthDay(held.fxDate)})`
                      : ''}
                  </p>
                  <dl className="grid grid-cols-3 gap-2 text-body-sm">
                    {[
                      ['Valuation', held.valueKrw === null ? '-' : formatWon(held.valueKrw)],
                      ['Cost basis', formatWon(held.costKrw)],
                      ['Gain/loss', profitText(held.profitKrw, held.returnPct)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex flex-col">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium break-words tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-expanded={ordering?.id === held.security.id}
                      aria-label={`${heldTitle(held)} order`}
                      onClick={() =>
                        setOrdering(
                          ordering?.id === held.security.id
                            ? undefined
                            : { id: held.security.id, title: heldTitle(held) },
                        )
                      }
                    >
                      {ordering?.id === held.security.id ? 'Close order' : 'Order'}
                    </Button>
                  </div>
                  {ordering?.id === held.security.id ? (
                    <div className="mt-2 rounded-xl border px-4 py-3">
                      <MockOrder
                        securityId={held.security.id}
                        title={heldTitle(held)}
                        currency={held.security.currency}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
