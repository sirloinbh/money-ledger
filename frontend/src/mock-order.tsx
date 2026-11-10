import { type FormEvent, useId, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatDecimal, formatWon } from './format';
import { RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { formatMonthDay, formatPrice } from './quote-format';

// #52 Market buy and sell of one security in the mock account. The server fills at the latest stored close
// and converts US orders with the latest stored rate; this screen only shows the preview it returns (no
// amounts are computed here) and sends one request key per order, so a double click fills once.

type Side = 'buy' | 'sell';
type Preview = {
  security: { id: number; symbol: string; name: string | null; currency: 'KRW' | 'USD' };
  price: string | null;
  priceDate: string | null;
  priceStale: boolean;
  fxRate: string | null;
  fxDate: string | null;
  amountKrw: number | null;
  feeKrw: number | null;
  cashKrw: number;
  cashAfterKrw: number | null;
  heldQuantity: string;
  problem: string | null;
};
type Ready = Preview & {
  price: string;
  priceDate: string;
  amountKrw: number;
  feeKrw: number;
  cashAfterKrw: number;
};
type Placed = { order: { priceDate: string }; cashKrw: number };

const sideNames: Record<Side, string> = { buy: '매수', sell: '매도' };

/** Whole shares from 1 to 1,000,000, as the server accepts them; commas are allowed while typing. */
function parseQuantity(text: string): { quantity: string } | { message: string } {
  const digits = text.trim().replaceAll(',', '');
  if (!/^[1-9]\d{0,6}$/.test(digits)) return { message: '수량은 1주 단위의 정수로 입력하세요' };
  if (Number(digits) > 1_000_000) return { message: '수량은 1,000,000주 이하로 입력하세요' };
  return { quantity: digits };
}

export function MockOrder({
  securityId,
  title,
  onOrdered,
}: {
  securityId: number;
  title: string;
  onOrdered: () => void;
}) {
  const [side, setSide] = useState<Side>('buy');
  const [quantity, setQuantity] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [preview, setPreview] = useState<{
    accountId: number;
    side: Side;
    quantity: string;
    data: Ready;
  }>();
  const [busy, setBusy] = useState(false);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  // Unique ids: a holding (#53) and the security detail can both show an order form on one page.
  const id = useId();
  const quantityInput = useRef<HTMLInputElement>(null);
  // One key per order: kept while the same order is retried (also after closing the dialog, in case the
  // answer to a filled order was lost), replaced once it filled, was refused or the order changed.
  const requestKey = useRef<{ order: string; key: string } | undefined>(undefined);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = parseQuantity(quantity);
    if ('message' in parsed) {
      setInvalid(true);
      showError(parsed.message);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      // The account is read each time, so an account reset in the meantime is never ordered against.
      const { account } = await requestJson<{ account: { id: number } | null }>(
        '/api/mock/accounts',
      );
      if (!account) {
        showError('모의투자 계좌를 먼저 만드세요');
        return;
      }
      const data = await requestJson<Preview>(
        `/api/mock/accounts/${account.id}/orders/preview?securityId=${securityId}&side=${side}&quantity=${parsed.quantity}`,
      );
      if (data.problem !== null || data.price === null || data.amountKrw === null) {
        showError(data.problem ?? '주문할 수 없습니다');
        return;
      }
      notice.clear();
      const order = `${account.id}:${securityId}:${side}:${parsed.quantity}`;
      if (requestKey.current?.order !== order) {
        requestKey.current = { order, key: crypto.randomUUID() };
      }
      setPreview({ accountId: account.id, side, quantity: parsed.quantity, data: data as Ready });
    } catch (cause) {
      showError(cause, '주문을 확인하지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    if (!preview || !requestKey.current) return;
    const { accountId } = preview;
    try {
      const placed = await requestJson<Placed>(`/api/mock/accounts/${accountId}/orders`, {
        method: 'POST',
        body: {
          securityId,
          side: preview.side,
          quantity: preview.quantity,
          requestKey: requestKey.current.key,
          // What the dialog showed: the server refuses the order if its close or rate changed since.
          expectedPrice: preview.data.price,
          expectedPriceDate: preview.data.priceDate,
          expectedFxRate: preview.data.fxRate,
        },
      });
      requestKey.current = undefined;
      setPreview(undefined);
      setQuantity('');
      showStatus(
        `${title} ${formatDecimal(preview.quantity)}주를 ${formatMonthDay(placed.order.priceDate)} 종가로 ${sideNames[preview.side]}했습니다. 현금 ${formatWon(placed.cashKrw)}`,
      );
      onOrdered();
    } catch (cause) {
      // A refusal (409: cash, holdings, price changed) closes the dialog so the reason shows on the screen.
      // A 5xx (for example a proxy timeout) may come after the order committed, so it is treated like a
      // lost connection below.
      if (cause instanceof RequestError && cause.status !== undefined && cause.status < 500) {
        requestKey.current = undefined;
        setPreview(undefined);
        showError(cause, '주문하지 못했습니다');
        throw cause;
      }
      // A lost connection keeps the key, so pressing again cannot fill twice. The order may have filled
      // anyway, so the account card is reloaded to show the cash as it is now.
      showError(
        `${cause instanceof Error ? cause.message : '주문하지 못했습니다'}. 주문이 체결됐을 수 있으니 계좌 현금을 확인하세요`,
      );
      onOrdered();
      throw cause;
    }
  };

  const ready = preview?.data;
  const description = ready ? (
    <span className="flex flex-col gap-1">
      <span>
        {`${formatMonthDay(ready.priceDate)} 종가 ${formatPrice(ready.price, ready.security.currency)}${
          ready.security.currency === 'KRW' ? '으로' : '로'
        } 체결합니다${ready.priceStale ? ' (시세 지연)' : ''}.`}
      </span>
      {ready.fxRate && ready.fxDate ? (
        <span>
          환율 {formatDecimal(ready.fxRate)}원({formatMonthDay(ready.fxDate)} 매매기준율)으로 원화로
          바꿉니다.
        </span>
      ) : null}
      {preview?.side === 'sell' ? (
        <span>
          보유 {formatDecimal(ready.heldQuantity)}주 중 {formatDecimal(preview.quantity)}주를
          팝니다.
        </span>
      ) : null}
      <span>
        체결 금액 {formatWon(ready.amountKrw)} · 수수료 {formatWon(ready.feeKrw)}
      </span>
      <span>주문 후 현금 {formatWon(ready.cashAfterKrw)}</span>
    </span>
  ) : undefined;

  return (
    // Named after the security: a holding (#53) and the security detail can each show a form on one page.
    <section aria-label={`${title} 모의 주문`} className="flex flex-col gap-3">
      <h3 className="text-body font-semibold">모의 주문</h3>
      <p id={`${id}-hint`} className="text-caption text-muted-foreground">
        저장된 최신 종가로 바로 체결합니다. 1주 단위로 주문할 수 있습니다.
      </p>
      <form
        aria-label={`${title} 모의 주문`}
        onSubmit={(event) => void check(event)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body-sm font-medium">주문 종류</legend>
          <div className="flex gap-2">
            {(['buy', 'sell'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={side === value ? 'default' : 'outline'}
                aria-pressed={side === value}
                onClick={() => setSide(value)}
              >
                {sideNames[value]}
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2 sm:w-40">
          <Label htmlFor={`${id}-quantity`}>수량(주)</Label>
          <Input
            id={`${id}-quantity`}
            ref={quantityInput}
            inputMode="numeric"
            autoComplete="off"
            value={quantity}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-notice` : `${id}-hint`}
            onChange={(event) => {
              if (invalid) setInvalid(false);
              setQuantity(event.target.value);
            }}
          />
        </div>
        {/* Stays enabled while checking so focus is kept; `busy` ignores a second press. */}
        <Button type="submit" aria-busy={busy || undefined}>
          {busy ? '확인하는 중…' : '주문 확인'}
        </Button>
      </form>
      <Notice id={`${id}-notice`} notice={notice.notice} />
      <ConfirmDialog
        title={
          preview
            ? `${title} ${formatDecimal(preview.quantity)}주 ${sideNames[preview.side]}`
            : '주문 확인'
        }
        description={description}
        confirmLabel={preview ? sideNames[preview.side] : '주문'}
        destructive={false}
        open={preview !== undefined}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined);
        }}
        onConfirm={place}
        returnFocusRef={quantityInput}
      />
    </section>
  );
}
