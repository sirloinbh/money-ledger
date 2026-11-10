import { useEffect, useRef, useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Notice } from './components/ui/notice';
import { formatDecimal, formatWon, signedPercent } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { MockOrder } from './mock-order';
import { formatMonthDay, formatPrice } from './quote-format';

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
 * `refreshKey` changes after an order on the page, so values are reloaded (#52). Each holding opens the
 * order form too: a suspended security (#97) is not found by search, so this is the way to sell it.
 */
export function MockHoldings({
  accountId,
  refreshKey,
  onOrdered,
}: {
  accountId: number;
  refreshKey: number;
  onOrdered: () => void;
}) {
  const [data, setData] = useState<{ accountId: number; data: Data } | undefined>(undefined);
  // The holding whose order form is open.
  const [ordering, setOrdering] = useState<number>();
  // Read when values come back, to tell whether the holding with the open form was sold out.
  const open = useRef<{ id: number; title: string } | undefined>(undefined);
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;

  useEffect(() => {
    let current = true;
    requestJson<Data>(`/api/mock/accounts/${accountId}/holdings`)
      .then((loaded) => {
        if (!current) return;
        const sold = open.current;
        if (sold && !loaded.holdings.some((held) => held.security.id === sold.id)) {
          // Its order form goes away with the row, so the result is said here.
          open.current = undefined;
          setOrdering(undefined);
          showStatus(`${sold.title} 보유분을 모두 팔았습니다`);
        } else clear();
        setData({ accountId, data: loaded });
      })
      .catch((cause: unknown) => {
        if (current) showError(cause, '보유 종목을 불러오지 못했습니다');
      });
    return () => {
      current = false;
    };
  }, [accountId, refreshKey, showError, showStatus, clear]);

  // Values of an account that was reset in the meantime are never shown for the new one.
  const loaded = data?.accountId === accountId ? data.data : undefined;

  return (
    <section aria-labelledby="mock-holdings-title" className="flex flex-col gap-3">
      <h3 id="mock-holdings-title" className="text-body font-semibold">
        보유 종목과 수익률
      </h3>
      <Notice id="mock-holdings-notice" notice={notice.notice} />
      {!loaded ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">보유 종목을 불러오는 중입니다</p>
        )
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                '총자산',
                loaded.summary.totalKrw === null ? '-' : formatWon(loaded.summary.totalKrw),
              ],
              [
                '평가금액',
                loaded.summary.valueKrw === null ? '-' : formatWon(loaded.summary.valueKrw),
              ],
              ['계좌 손익', profitText(loaded.summary.profitKrw, null)],
              [
                '수익률',
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
            총자산은 현금 잔고와 평가금액의 합이고, 수익률은 시작 금액 대비입니다. 평가금액은 저장된
            최신 종가와 환율로 계산합니다.
            {loaded.summary.totalKrw === null
              ? ' 시세나 환율이 없는 종목이 있어 총자산을 계산하지 못했습니다.'
              : ''}
          </p>
          {loaded.holdings.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">
              보유 종목이 없습니다. 아래에서 종목을 찾아 모의 주문을 해 보세요.
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
                    {held.security.active ? null : <Badge variant="warning">거래 중단</Badge>}
                  </div>
                  <p className="text-body-sm text-muted-foreground tabular-nums">
                    {formatDecimal(held.quantity)}주
                    {held.price !== null && held.priceDate !== null
                      ? ` · ${held.priceStale ? '시세 지연 · ' : ''}${formatMonthDay(held.priceDate)} 종가 ${formatPrice(held.price, held.security.currency)}`
                      : ' · 종가 없음'}
                    {held.fxRate !== null && held.fxDate !== null
                      ? ` · 환율 ${formatDecimal(held.fxRate)}원(${formatMonthDay(held.fxDate)})`
                      : ''}
                  </p>
                  <dl className="grid grid-cols-3 gap-2 text-body-sm">
                    {[
                      ['평가금액', held.valueKrw === null ? '-' : formatWon(held.valueKrw)],
                      ['매입원가', formatWon(held.costKrw)],
                      ['손익', profitText(held.profitKrw, held.returnPct)],
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
                      aria-expanded={ordering === held.security.id}
                      aria-label={`${heldTitle(held)} 주문`}
                      onClick={() => {
                        const closing = ordering === held.security.id;
                        open.current = closing
                          ? undefined
                          : { id: held.security.id, title: heldTitle(held) };
                        setOrdering(closing ? undefined : held.security.id);
                      }}
                    >
                      {ordering === held.security.id ? '주문 닫기' : '주문'}
                    </Button>
                  </div>
                  {ordering === held.security.id ? (
                    <div className="mt-2 rounded-xl border px-4 py-3">
                      <MockOrder
                        securityId={held.security.id}
                        title={heldTitle(held)}
                        onOrdered={onOrdered}
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
