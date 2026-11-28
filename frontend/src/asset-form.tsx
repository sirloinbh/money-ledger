import type { ChangeEvent, FormEvent, RefObject } from 'react';

import {
  type Asset,
  type AssetType,
  type Draft,
  type Field,
  lifePresets,
  maxDate,
  minDate,
  selectClass,
  tradeableTypes,
  typeLabels,
  typeOrder,
} from './asset-model';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { SecurityPicker } from './security-picker';

// #190 The new and edit asset form. The draft, the wrong field, and saving stay with AssetManager.

/** What an input for a draft field takes: its value, the wrong-field marks, and a change that clears the mark. */
type Bind = (field: Field) => {
  value: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

type FieldsProps = {
  draft: Draft;
  bind: Bind;
  onChange: (patch: Partial<Draft>) => void;
};

export function AssetForm({
  draft,
  editing,
  invalid,
  busy,
  nameRef,
  onChange,
  onClearInvalid,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  editing: Asset | undefined;
  invalid: Field | undefined;
  busy: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<Draft>) => void;
  onClearInvalid: (field: Field) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const bind: Bind = (field) => ({
    value: draft[field],
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? 'assets-notice' : undefined,
    onChange: (event) => {
      onClearInvalid(field);
      onChange({ [field]: event.target.value });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">{editing ? 'Edit asset' : 'New asset'}</CardTitle>
        <CardDescription>
          A stock is valued at the received close when a security is linked, or at the current price
          you enter when it is not. A dollar asset is converted to won at the latest saved base
          rate. A depreciable asset loses the same amount from its purchase price every month.
          Record a prepaid asset as an expense in the ledger on the day you pay, and keep only the
          remaining value here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          aria-label={editing ? 'Edit asset' : 'New asset'}
          onSubmit={onSubmit}
          className="grid gap-4 md:grid-cols-2"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-name">Name</Label>
            <Input id="asset-name" ref={nameRef} maxLength={50} {...bind('name')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-type">Type</Label>
            <select
              id="asset-type"
              className={selectClass}
              value={draft.type}
              onChange={(event) => onChange({ type: event.target.value as AssetType })}
            >
              {typeOrder.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </div>
          {draft.type === 'prepaid' ? (
            <PrepaidFields draft={draft} bind={bind} onChange={onChange} />
          ) : draft.type === 'depreciable' ? (
            <DepreciationFields
              draft={draft}
              bind={bind}
              onChange={onChange}
              onClearInvalid={onClearInvalid}
            />
          ) : (
            <ValueFields draft={draft} bind={bind} onChange={onChange} editing={editing} />
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-memo">Note</Label>
            <Input
              id="asset-memo"
              maxLength={200}
              value={draft.memo}
              onChange={(event) => onChange({ memo: event.target.value })}
            />
          </div>
          <div className="flex gap-2 md:col-span-2">
            {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}
            </Button>
            {editing ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** #64 A voucher (amount loaded, optional expiry) or a pass (amount paid, start and expiry). */
function PrepaidFields({ draft, bind, onChange }: FieldsProps) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body-sm font-medium">Prepaid type</legend>
        <div className="flex gap-4">
          {(
            [
              ['amount', 'Voucher'],
              ['period', 'Pass'],
            ] as const
          ).map(([kind, label]) => (
            <label key={kind} className="flex items-center gap-2 text-body-sm">
              <input
                type="radio"
                name="asset-prepaid-kind"
                value={kind}
                checked={draft.prepaidKind === kind}
                // A pass with uses is refused by the server; it says so.
                onChange={() => onChange({ prepaidKind: kind })}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-prepaid-amount">
          {draft.prepaidKind === 'amount' ? 'Amount loaded (KRW)' : 'Amount paid (KRW)'}
        </Label>
        <Input
          id="asset-prepaid-amount"
          inputMode="numeric"
          autoComplete="off"
          {...bind('prepaidAmount')}
        />
      </div>
      {draft.prepaidKind === 'period' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="asset-starts-on">Start date</Label>
          <Input
            id="asset-starts-on"
            type="date"
            min={minDate}
            max={maxDate}
            {...bind('startsOn')}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-expires-on">
          {draft.prepaidKind === 'period'
            ? 'Expiry date (usable through this day)'
            : 'Expiry date (optional)'}
        </Label>
        <Input
          id="asset-expires-on"
          type="date"
          min={minDate}
          max={maxDate}
          {...bind('expiresOn')}
        />
      </div>
    </>
  );
}

/** #63 Purchase price, date, useful life (typed or from a preset), and salvage value. */
function DepreciationFields({
  draft,
  bind,
  onChange,
  onClearInvalid,
}: FieldsProps & { onClearInvalid: (field: Field) => void }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-purchase-price">Purchase price (KRW)</Label>
        <Input
          id="asset-purchase-price"
          inputMode="numeric"
          autoComplete="off"
          {...bind('purchasePrice')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-purchased-on">Purchase date</Label>
        <Input
          id="asset-purchased-on"
          type="date"
          min={minDate}
          max={maxDate}
          {...bind('purchasedOn')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-life-preset">Default useful life</Label>
        <select
          id="asset-life-preset"
          className={selectClass}
          value={
            lifePresets.find((preset) => String(preset.months) === draft.lifeMonths.trim())
              ?.months ?? ''
          }
          onChange={(event) => {
            onClearInvalid('lifeMonths');
            onChange({ lifeMonths: event.target.value });
          }}
        >
          <option value="">Enter manually</option>
          {lifePresets.map((preset) => (
            <option key={preset.months} value={preset.months}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-life-months">Useful life (months)</Label>
        <Input
          id="asset-life-months"
          inputMode="numeric"
          autoComplete="off"
          {...bind('lifeMonths')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-salvage">Salvage value (KRW)</Label>
        <Input id="asset-salvage" inputMode="numeric" autoComplete="off" {...bind('salvage')} />
      </div>
    </>
  );
}

/**
 * Every other type: the linked security (stocks), currency, quantity, valuation, and the hand price of an
 * unlinked stock or other asset (#47).
 */
function ValueFields({
  draft,
  bind,
  onChange,
  editing,
}: FieldsProps & { editing: Asset | undefined }) {
  const tradeManaged = editing?.hasTrades === true;
  // #47 A linked stock takes the security's currency and its stored close (no hand price).
  const linked = draft.type === 'stock' && draft.security !== null;
  return (
    <>
      {draft.type === 'stock' ? (
        <SecurityPicker
          value={draft.security}
          locked={tradeManaged ? (editing?.currency ?? false) : false}
          onChange={(security) =>
            onChange(security ? { security, currency: security.currency } : { security })
          }
        />
      ) : null}
      <fieldset className="flex flex-col gap-2" disabled={linked}>
        <legend className="mb-2 text-body-sm font-medium">
          {linked ? 'Currency (from the security)' : 'Currency'}
        </legend>
        <div className="flex gap-4">
          {(['KRW', 'USD'] as const).map((currency) => (
            <label key={currency} className="flex items-center gap-2 text-body-sm">
              <input
                type="radio"
                name="asset-currency"
                value={currency}
                checked={draft.currency === currency}
                onChange={() => onChange({ currency })}
                className="size-4 accent-primary"
              />
              {currency === 'KRW' ? 'Won (KRW)' : 'Dollar (USD)'}
            </label>
          ))}
        </div>
      </fieldset>
      {draft.type === 'debt' ? null : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="asset-quantity">
            {tradeManaged ? 'Quantity (trade total)' : 'Quantity (optional)'}
          </Label>
          <Input
            id="asset-quantity"
            inputMode="decimal"
            autoComplete="off"
            // #46 Decision: an asset with trades takes its quantity from them.
            readOnly={tradeManaged}
            {...bind('quantity')}
            aria-describedby={
              tradeManaged ? 'asset-quantity-hint' : bind('quantity')['aria-describedby']
            }
          />
          {tradeManaged ? (
            <p id="asset-quantity-hint" className="text-caption text-muted-foreground">
              This asset has trades, so its quantity changes only through them.
            </p>
          ) : null}
        </div>
      )}
      {linked ? null : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="asset-value">
            {draft.type === 'debt' ? 'Remaining amount' : 'Valuation'} (
            {draft.currency === 'KRW' ? 'KRW' : 'USD'})
          </Label>
          <Input
            id="asset-value"
            inputMode={draft.currency === 'KRW' ? 'numeric' : 'decimal'}
            autoComplete="off"
            {...bind('value')}
          />
        </div>
      )}
      {tradeableTypes.includes(draft.type) && !linked ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-manual-price">
              Current price (per unit, {draft.currency === 'KRW' ? 'KRW' : 'USD'}, optional)
            </Label>
            <Input
              id="asset-manual-price"
              inputMode={draft.currency === 'KRW' ? 'numeric' : 'decimal'}
              autoComplete="off"
              {...bind('manualPrice')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-manual-priced-on">Current-price date (today if empty)</Label>
            <Input
              id="asset-manual-priced-on"
              type="date"
              min={minDate}
              max={maxDate}
              {...bind('manualPricedOn')}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
