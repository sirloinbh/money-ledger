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

const sideLabels: Record<Side, string> = { buy: 'Buy', sell: 'Sell' };

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);
const priceText = (price: string, currency: Currency) =>
  currency === 'USD' ? formatUsd(price) : `₩${formatDecimal(price)}`;

/** The request body, or the field and message that is wrong (the server checks again). */
function toBody(
  draft: Draft,
  currency: Currency,
): { body: object } | { field: Field; message: string } {
  if (!realDate(draft.tradedOn)) {
    return { field: 'tradedOn', message: 'Enter a trade date between 1900 and 2100' };
  }
  if (draft.tradedOn > serviceToday()) {
    return { field: 'tradedOn', message: 'Trades dated after today cannot be recorded' };
  }
  const quantity = digits(draft.quantity);
  if (!/^\d{1,12}(\.\d{1,8})?$/.test(quantity) || !/[1-9]/.test(quantity)) {
    return { field: 'quantity', message: 'Enter a quantity above 0 with up to 8 decimal places' };
  }
  const price = digits(draft.price);
  const pricePattern = currency === 'KRW' ? /^\d{1,16}$/ : /^\d{1,16}(\.\d{1,4})?$/;
  if (!pricePattern.test(price) || !/[1-9]/.test(price)) {
    return {
      field: 'price',
      message:
        currency === 'KRW'
          ? 'Enter a unit price above 0 as a whole number of won'
          : 'Enter a unit price above 0 with up to 4 decimal places',
    };
  }
  let fxRate: string | null = null;
  if (currency === 'USD') {
    fxRate = digits(draft.fxRate);
    if (!/^\d{1,8}(\.\d{1,4})?$/.test(fxRate) || !/[1-9]/.test(fxRate)) {
      return {
        field: 'fxRate',
        message: "Enter that day's exchange rate (won per dollar) with up to 4 decimal places",
      };
    }
  }
  const wonOf = (text: string) => {
    const plain = digits(text) || '0';
    return /^\d{1,16}$/.test(plain) && Number(plain) <= 1e15 ? Number(plain) : undefined;
  };
  const feeKrw = wonOf(draft.fee);
  if (feeKrw === undefined)
    return { field: 'fee', message: 'Enter the fee as a whole number of won, 0 or more' };
  const taxKrw = wonOf(draft.tax);
  if (taxKrw === undefined)
    return { field: 'tax', message: 'Enter the tax as a whole number of won, 0 or more' };
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
    load().catch((cause: unknown) => showError(cause, 'Could not load the trades'));
  }, [load, showError]);

  const refresh = async (done: string) => {
    try {
      await Promise.all([load(), onChanged()]);
      showStatus(done);
    } catch {
      showError(`${done}. Could not reload the list`);
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
      showError('Saving in progress. Try again in a moment');
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
      const done = `${draft.tradedOn} ${sideLabels[draft.side]} ${editing ? 'updated' : 'recorded'}`;
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
      showError('Saving in progress. Try again in a moment');
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
    await refresh(`${trade.tradedOn} ${sideLabels[trade.side]} record deleted`);
  };

  const unit = currency === 'USD' ? 'USD' : 'KRW';
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
        {assetName} trades
      </h4>
      {position ? (
        <dl className="grid grid-cols-2 gap-2 text-body-sm sm:grid-cols-4">
          {[
            ['Quantity held', position.quantity === null ? '0' : formatDecimal(position.quantity)],
            [
              // USD: in dollars without the won fees, which have no dollar rate of their own; the won
              // cost below includes them (decision 3).
              currency === 'USD' ? 'Average unit price (excl. fees)' : 'Average unit price',
              position.averagePrice === null ? '-' : priceText(position.averagePrice, currency),
            ],
            ['Cost in KRW', formatWon(position.costKrw)],
            ['Realized P/L', signedWon(position.realizedKrw)],
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
          The current quantity {formatDecimal(handQuantity)} was entered by hand. Recording the
          first trade replaces it with the trade total, so enter any quantity you already hold as a
          buy first.
        </p>
      ) : null}
      <Notice id={noticeId} notice={notice.notice} />
      <form
        aria-label={`${assetName} ${editing ? 'Edit trade' : 'Add trade'}`}
        onSubmit={(event) => void submit(event)}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-body-sm font-medium">Side</legend>
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
          <Label htmlFor={`${prefix}-date`}>Trade date</Label>
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
          <Label htmlFor={`${prefix}-quantity`}>Quantity</Label>
          <Input
            id={`${prefix}-quantity`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 10 or 0.5"
            value={draft.quantity}
            {...fieldProps('quantity')}
            onChange={(event) => change({ quantity: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-price`}>Unit price ({unit})</Label>
          <Input
            id={`${prefix}-price`}
            inputMode={currency === 'USD' ? 'decimal' : 'numeric'}
            autoComplete="off"
            placeholder={currency === 'USD' ? 'e.g. 123.45' : 'e.g. 71000'}
            value={draft.price}
            {...fieldProps('price')}
            onChange={(event) => change({ price: event.target.value })}
          />
        </div>
        {currency === 'USD' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${prefix}-fx`}>Exchange rate (KRW per USD)</Label>
            <Input
              id={`${prefix}-fx`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 1385.25"
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
                {formatMonthDay(latestFx.rateDate)} base rate was prefilled. You can change it to
                the rate on the trade date.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-fee`}>Fee (KRW)</Label>
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
          <Label htmlFor={`${prefix}-tax`}>Tax (KRW)</Label>
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
          <Label htmlFor={`${prefix}-memo`}>Note</Label>
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
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add trade'}
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
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>
      {trades === undefined ? null : trades.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">No trades recorded yet.</p>
      ) : (
        <ul aria-label={`${assetName} trade list`} className="flex flex-col divide-y">
          {trades.map((trade) => {
            const label = `${trade.tradedOn} ${sideLabels[trade.side]} ${formatDecimal(trade.quantity)} × ${priceText(trade.price, trade.currency)}`;
            const costs = trade.feeKrw + trade.taxKrw;
            return (
              <li key={trade.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex min-w-0 flex-col gap-0.5 text-body-sm">
                  <span className="break-words">
                    {trade.tradedOn} · {sideLabels[trade.side]} · {formatDecimal(trade.quantity)} ×{' '}
                    {priceText(trade.price, trade.currency)}
                    {trade.fxRate === null ? '' : ` · rate ${formatDecimal(trade.fxRate)}`}
                    {trade.memo ? ` · ${trade.memo}` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {formatWon(trade.amountKrw)}
                    {costs > 0 ? ` · costs ${formatWon(costs)}` : ''}
                    {` · holding ${formatDecimal(trade.quantityAfter)}`}
                    {trade.realizedKrw === null
                      ? ''
                      : ` · realized P/L ${signedWon(trade.realizedKrw)}`}
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${label}`}
                    onClick={() => startEdit(trade)}
                  >
                    Edit
                  </Button>
                  <ConfirmDialog
                    title="Delete this trade?"
                    description={`${label}. Deleting it recalculates the quantity held and the P/L.`}
                    confirmLabel="Delete"
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
                        aria-label={`Delete ${label}`}
                      >
                        Delete
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
