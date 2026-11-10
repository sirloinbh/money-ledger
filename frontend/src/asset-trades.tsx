import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import {
  formatDecimal,
  formatUsd,
  formatWon,
  realDate,
  serviceToday,
  withoutThousands as digits,
} from './format';
import { RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { formatMonthDay } from './quote-format';

// #46 Buy and sell records of a stock or other asset. The server works out the held quantity, the
// moving-average price and the realized profit (decisions 2026-11-08): buy fees go into the cost, sell fees
// and taxes come off the profit, a USD asset averages in dollars and realizes in won with the entered rate.
// #47 A new USD trade starts with the newest stored USD rate in its rate field (decision 2026-11-10).

type Side = 'buy' | 'sell';
type Currency = 'KRW' | 'USD';
type Trade = {
  id: number;
  side: Side;
  tradedOn: string;
  quantity: string;
  currency: Currency;
  price: string;
  fxRate: string | null;
  amountKrw: number;
  feeKrw: number;
  taxKrw: number;
  memo: string;
  quantityAfter: string;
  realizedKrw: number | null;
};
type Position = {
  quantity: string | null;
  averagePrice: string | null;
  costKrw: number;
  realizedKrw: number;
};
type Draft = {
  side: Side;
  tradedOn: string;
  quantity: string;
  price: string;
  fxRate: string;
  fee: string;
  tax: string;
  memo: string;
};
type Field = 'tradedOn' | 'quantity' | 'price' | 'fxRate' | 'fee' | 'tax';

const emptyDraft = (): Draft => ({
  side: 'buy',
  tradedOn: serviceToday(),
  quantity: '',
  price: '',
  fxRate: '',
  fee: '0',
  tax: '0',
  memo: '',
});

const sideLabels: Record<Side, string> = { buy: '매수', sell: '매도' };

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);
const priceText = (price: string, currency: Currency) =>
  currency === 'USD' ? formatUsd(price) : `${formatDecimal(price)}원`;

/** The request body, or the field and Korean message that is wrong (the server checks again). */
function toBody(
  draft: Draft,
  currency: Currency,
): { body: object } | { field: Field; message: string } {
  if (!realDate(draft.tradedOn)) {
    return { field: 'tradedOn', message: '거래일을 1900년부터 2100년 사이로 입력하세요' };
  }
  if (draft.tradedOn > serviceToday()) {
    return { field: 'tradedOn', message: '오늘 이후 날짜의 거래는 기록할 수 없습니다' };
  }
  const quantity = digits(draft.quantity);
  if (!/^\d{1,12}(\.\d{1,8})?$/.test(quantity) || !/[1-9]/.test(quantity)) {
    return { field: 'quantity', message: '수량은 0보다 큰 수로, 소수 8자리까지 입력하세요' };
  }
  const price = digits(draft.price);
  const pricePattern = currency === 'KRW' ? /^\d{1,16}$/ : /^\d{1,16}(\.\d{1,4})?$/;
  if (!pricePattern.test(price) || !/[1-9]/.test(price)) {
    return {
      field: 'price',
      message:
        currency === 'KRW'
          ? '단가는 0보다 큰 원 단위 정수로 입력하세요'
          : '단가는 0보다 큰 수로, 소수 4자리까지 입력하세요',
    };
  }
  let fxRate: string | null = null;
  if (currency === 'USD') {
    fxRate = digits(draft.fxRate);
    if (!/^\d{1,8}(\.\d{1,4})?$/.test(fxRate) || !/[1-9]/.test(fxRate)) {
      return { field: 'fxRate', message: '그날 환율(1달러당 원)을 소수 4자리까지 입력하세요' };
    }
  }
  const wonOf = (text: string) => {
    const plain = digits(text) || '0';
    return /^\d{1,16}$/.test(plain) && Number(plain) <= 1e15 ? Number(plain) : undefined;
  };
  const feeKrw = wonOf(draft.fee);
  if (feeKrw === undefined)
    return { field: 'fee', message: '수수료는 0 이상의 원 단위 정수로 입력하세요' };
  const taxKrw = wonOf(draft.tax);
  if (taxKrw === undefined)
    return { field: 'tax', message: '세금은 0 이상의 원 단위 정수로 입력하세요' };
  return {
    body: {
      side: draft.side,
      tradedOn: draft.tradedOn,
      quantity,
      price,
      fxRate,
      feeKrw,
      taxKrw,
      memo: draft.memo,
    },
  };
}

export function AssetTrades({
  assetId,
  assetName,
  currency,
  handQuantity,
  latestFx = null,
  onChanged,
}: {
  assetId: number;
  assetName: string;
  currency: Currency;
  /** The quantity entered by hand while the asset has no trades yet (the first trade replaces it). */
  handQuantity: string | null;
  /** The newest stored USD rate, filled into a new USD trade (it can be changed). */
  latestFx?: { fxRate: string; rateDate: string } | null;
  /** Reloads the asset list so the quantity follows the trades. */
  onChanged: () => Promise<void>;
}) {
  const [trades, setTrades] = useState<Trade[] | undefined>(undefined);
  const [position, setPosition] = useState<Position | undefined>(undefined);
  const prefillFx =
    currency === 'USD' && latestFx ? formatDecimal(latestFx.fxRate).replaceAll(',', '') : '';
  // A blank trade: the rate starts from the newest stored rate.
  const blank = useCallback(() => ({ ...emptyDraft(), fxRate: prefillFx }), [prefillFx]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<Trade | undefined>(undefined);
  const [invalid, setInvalid] = useState<Field | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  const path = `/api/portfolio/assets/${assetId}/trades`;
  const prefix = `trade-${assetId}`;
  const noticeId = `${prefix}-notice`;

  const load = useCallback(async () => {
    const data = await requestJson<{ trades: Trade[]; position: Position }>(path);
    setTrades(data.trades);
    setPosition(data.position);
  }, [path]);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, '거래 내역을 불러오지 못했습니다'));
  }, [load, showError]);

  const refresh = async (done: string) => {
    try {
      await Promise.all([load(), onChanged()]);
      showStatus(done);
    } catch {
      showError(`${done}. 목록을 새로 불러오지 못했습니다`);
    }
  };

  // The note says the rate was filled in; once changed it is the user's own rate.
  const showFxHint = !editing && latestFx !== null && draft.fxRate === prefillFx;
  const filledFx = useRef(prefillFx);
  useEffect(() => {
    const previous = filledFx.current;
    filledFx.current = prefillFx;
    if (editing) return;
    setDraft((current) =>
      current.fxRate === previous ? { ...current, fxRate: prefillFx } : current,
    );
  }, [prefillFx, editing]);

  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const fieldProps = (field: Field) => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? noticeId : undefined,
    onInput: () => {
      if (invalid === field) setInvalid(undefined);
    },
  });

  const startEdit = (trade: Trade) => {
    if (saving.current) return;
    setInvalid(undefined);
    setEditing(trade);
    setDraft({
      side: trade.side,
      tradedOn: trade.tradedOn,
      quantity: formatDecimal(trade.quantity).replaceAll(',', ''),
      price: formatDecimal(trade.price).replaceAll(',', ''),
      fxRate: trade.fxRate === null ? '' : formatDecimal(trade.fxRate).replaceAll(',', ''),
      fee: String(trade.feeKrw),
      tax: String(trade.taxKrw),
      memo: trade.memo,
    });
    notice.clear();
    // The form is above the list.
    requestAnimationFrame(() => firstField.current?.focus());
  };

  const stopEdit = () => {
    setInvalid(undefined);
    setEditing(undefined);
    setDraft(blank());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) {
      showError('저장 중입니다. 잠시 후 다시 시도하세요');
      return;
    }
    const result = toBody(draft, currency);
    if ('field' in result) {
      setInvalid(result.field);
      showError(result.message);
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    try {
      try {
        await (editing
          ? requestJson(`${path}/${editing.id}`, { method: 'PUT', body: result.body })
          : requestJson(path, { method: 'POST', body: result.body }));
      } catch (cause) {
        // The server refuses a sell above what is held at that date; its message names the date.
        showError(cause);
        return;
      }
      const done = `${draft.tradedOn} ${sideLabels[draft.side]}를 ${editing ? '수정' : '기록'}했습니다`;
      if (editing) stopEdit();
      else setDraft((current) => ({ ...blank(), side: current.side }));
      await refresh(done);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  // Called by the confirm dialog: rejecting keeps it open with the error shown.
  const remove = async (trade: Trade) => {
    if (saving.current) {
      showError('저장 중입니다. 잠시 후 다시 시도하세요');
      throw new Error('saving');
    }
    saving.current = true;
    setBusy(true);
    try {
      await requestJson(`${path}/${trade.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      if (cause instanceof RequestError && cause.status === 404) await load().catch(() => {});
      throw cause;
    } finally {
      saving.current = false;
      setBusy(false);
    }
    afterDelete.current = title.current;
    if (editing?.id === trade.id) stopEdit();
    await refresh(`${trade.tradedOn} ${sideLabels[trade.side]} 기록을 지웠습니다`);
  };

  const unit = currency === 'USD' ? '달러' : '원';
  return (
    <section
      aria-labelledby={`${prefix}-title`}
      className="flex w-full flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <h4
        id={`${prefix}-title`}
        ref={title}
        tabIndex={-1}
        className="text-body-sm font-semibold outline-none"
      >
        {assetName} 거래 내역
      </h4>
      {position ? (
        <dl className="grid grid-cols-2 gap-2 text-body-sm sm:grid-cols-4">
          {[
            ['보유 수량', position.quantity === null ? '0' : formatDecimal(position.quantity)],
            [
              // USD: in dollars without the won fees, which have no dollar rate of their own; the won
              // cost below includes them (decision 3).
              currency === 'USD' ? '평균 단가(수수료 제외)' : '평균 단가',
              position.averagePrice === null ? '-' : priceText(position.averagePrice, currency),
            ],
            ['원화 원가', formatWon(position.costKrw)],
            ['실현 손익', signedWon(position.realizedKrw)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {handQuantity !== null && trades?.length === 0 ? (
        <p id={`${prefix}-hand`} className="text-body-sm text-muted-foreground">
          지금 수량 {formatDecimal(handQuantity)}은(는) 직접 넣은 값입니다. 첫 거래를 기록하면
          수량이 거래 합계로 바뀌므로, 이미 가진 수량은 매수로 먼저 넣으세요.
        </p>
      ) : null}
      <Notice id={noticeId} notice={notice.notice} />
      <form
        aria-label={`${assetName} ${editing ? '거래 수정' : '거래 추가'}`}
        onSubmit={(event) => void submit(event)}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-body-sm font-medium">구분</legend>
          <div className="flex gap-4">
            {(['buy', 'sell'] as const).map((side) => (
              <label key={side} className="flex items-center gap-2 text-body-sm">
                <input
                  type="radio"
                  name={`${prefix}-side`}
                  value={side}
                  checked={draft.side === side}
                  onChange={() => change({ side })}
                  className="size-4 accent-primary"
                />
                {sideLabels[side]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-date`}>거래일</Label>
          <Input
            id={`${prefix}-date`}
            ref={firstField}
            type="date"
            min="1900-01-01"
            max={serviceToday()}
            value={draft.tradedOn}
            {...fieldProps('tradedOn')}
            onChange={(event) => change({ tradedOn: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-quantity`}>수량</Label>
          <Input
            id={`${prefix}-quantity`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="예: 10 또는 0.5"
            value={draft.quantity}
            {...fieldProps('quantity')}
            onChange={(event) => change({ quantity: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-price`}>단가({unit})</Label>
          <Input
            id={`${prefix}-price`}
            inputMode={currency === 'USD' ? 'decimal' : 'numeric'}
            autoComplete="off"
            placeholder={currency === 'USD' ? '예: 123.45' : '예: 71000'}
            value={draft.price}
            {...fieldProps('price')}
            onChange={(event) => change({ price: event.target.value })}
          />
        </div>
        {currency === 'USD' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${prefix}-fx`}>환율(1달러당 원)</Label>
            <Input
              id={`${prefix}-fx`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="예: 1385.25"
              value={draft.fxRate}
              {...fieldProps('fxRate')}
              aria-describedby={
                [fieldProps('fxRate')['aria-describedby'], showFxHint ? `${prefix}-fx-hint` : '']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onChange={(event) => change({ fxRate: event.target.value })}
            />
            {showFxHint && latestFx ? (
              <p id={`${prefix}-fx-hint`} className="text-caption text-muted-foreground">
                {formatMonthDay(latestFx.rateDate)} 매매기준율을 미리 채웠습니다. 거래한 날 환율로
                고칠 수 있습니다.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-fee`}>수수료(원)</Label>
          <Input
            id={`${prefix}-fee`}
            inputMode="numeric"
            autoComplete="off"
            value={draft.fee}
            {...fieldProps('fee')}
            onChange={(event) => change({ fee: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-tax`}>세금(원)</Label>
          <Input
            id={`${prefix}-tax`}
            inputMode="numeric"
            autoComplete="off"
            value={draft.tax}
            {...fieldProps('tax')}
            onChange={(event) => change({ tax: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-memo`}>메모</Label>
          <Input
            id={`${prefix}-memo`}
            maxLength={100}
            value={draft.memo}
            onChange={(event) => change({ memo: event.target.value })}
          />
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
          <Button type="submit" size="sm" aria-busy={busy || undefined}>
            {busy ? '저장 중…' : editing ? '수정 저장' : '거래 추가'}
          </Button>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (saving.current) return;
                stopEdit();
                firstField.current?.focus();
              }}
            >
              수정 취소
            </Button>
          ) : null}
        </div>
      </form>
      {trades === undefined ? null : trades.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">아직 거래 기록이 없습니다.</p>
      ) : (
        <ul aria-label={`${assetName} 거래 목록`} className="flex flex-col divide-y">
          {trades.map((trade) => {
            const label = `${trade.tradedOn} ${sideLabels[trade.side]} ${formatDecimal(trade.quantity)} × ${priceText(trade.price, trade.currency)}`;
            const costs = trade.feeKrw + trade.taxKrw;
            return (
              <li key={trade.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex min-w-0 flex-col gap-0.5 text-body-sm">
                  <span className="break-words">
                    {trade.tradedOn} · {sideLabels[trade.side]} · {formatDecimal(trade.quantity)} ×{' '}
                    {priceText(trade.price, trade.currency)}
                    {trade.fxRate === null ? '' : ` · 환율 ${formatDecimal(trade.fxRate)}`}
                    {trade.memo ? ` · ${trade.memo}` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {formatWon(trade.amountKrw)}
                    {costs > 0 ? ` · 비용 ${formatWon(costs)}` : ''}
                    {` · 보유 ${formatDecimal(trade.quantityAfter)}`}
                    {trade.realizedKrw === null
                      ? ''
                      : ` · 실현 손익 ${signedWon(trade.realizedKrw)}`}
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${label} 수정`}
                    onClick={() => startEdit(trade)}
                  >
                    수정
                  </Button>
                  <ConfirmDialog
                    title="거래 기록을 지울까요?"
                    description={`${label}. 지우면 보유 수량과 손익을 다시 계산합니다.`}
                    confirmLabel="지우기"
                    onConfirm={() => remove(trade)}
                    returnFocusRef={afterDelete}
                    onOpenChange={(open) => {
                      if (open) afterDelete.current = null;
                    }}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${label} 지우기`}
                      >
                        지우기
                      </Button>
                    }
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
