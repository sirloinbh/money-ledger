import type { FormEvent, RefObject } from 'react';

import { categoryLabel } from './category-label';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Combobox } from './components/ui/combobox';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { kindLabel, selectClass } from './entry-filters-state';
import {
  type Category,
  type Draft,
  type DraftPart,
  type Entry,
  parseAmount,
  type PaymentMethod,
  paymentMethodLabel,
} from './entry-model';
import { formatWon } from './format';

// #190 The new and edit entry form. The draft, the wrong field, and saving stay with EntryManager.

export type EntryField = 'amount' | 'category';

/** #292 The parts of a split payment: a category and an amount each, with what is left to assign. */
function SplitEditor({
  draft,
  choices,
  onChange,
}: {
  draft: Draft;
  choices: Category[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  const total = parseAmount(draft.amount);
  const sum = draft.splits.reduce((acc, part) => acc + (parseAmount(part.amount) ?? 0), 0);
  const left = total === undefined ? undefined : total - sum;
  const set = (index: number, patch: Partial<DraftPart>) =>
    onChange({
      splits: draft.splits.map((part, at) => (at === index ? { ...part, ...patch } : part)),
    });
  return (
    <fieldset className="flex flex-col gap-3 md:col-span-2">
      <legend className="mb-2 text-body-sm font-medium">Split into parts</legend>
      {draft.splits.map((part, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_10rem_auto]"
        >
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <Label htmlFor={`entry-part-category-${index}`}>Part {index + 1} category</Label>
            <select
              id={`entry-part-category-${index}`}
              className={selectClass}
              value={part.categoryId}
              onChange={(event) => set(index, { categoryId: event.target.value })}
            >
              <option value="">Choose a category</option>
              {choices.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.hidden
                    ? `${categoryLabel(category.name)} (hidden)`
                    : categoryLabel(category.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`entry-part-amount-${index}`}>Part {index + 1} amount</Label>
            <Input
              id={`entry-part-amount-${index}`}
              inputMode="numeric"
              autoComplete="off"
              value={part.amount}
              onChange={(event) => set(index, { amount: event.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={draft.splits.length <= 2}
            aria-label={`Remove part ${index + 1}`}
            onClick={() => onChange({ splits: draft.splits.filter((_, at) => at !== index) })}
          >
            Remove
          </Button>
        </div>
      ))}
      <p aria-live="polite" className="text-body-sm text-muted-foreground">
        {left === undefined
          ? 'Enter the payment amount first.'
          : left === 0
            ? 'The parts add up to the payment.'
            : left > 0
              ? `${formatWon(left)} is left to assign.`
              : `The parts are ${formatWon(-left)} over the payment.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.splits.length >= 10}
          onClick={() => onChange({ splits: [...draft.splits, { categoryId: '', amount: '' }] })}
        >
          Add a part
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              splits: [],
              categoryId: draft.splits.find((part) => part.categoryId)?.categoryId ?? '',
            })
          }
        >
          Undo the split
        </Button>
      </div>
    </fieldset>
  );
}

export function EntryForm({
  draft,
  editing,
  invalid,
  busy,
  choices,
  stale,
  categoryId,
  merchants,
  dateRef,
  onChange,
  onClearInvalid,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  editing: Entry | undefined;
  invalid: EntryField | undefined;
  busy: boolean;
  /** The categories offered for the draft's kind (see categoryChoice). */
  choices: Category[];
  /** The chosen category is no longer offered and must be chosen again. */
  stale: boolean;
  categoryId: string;
  /** Merchants of the entries already listed, offered as suggestions (#361). */
  merchants: readonly string[];
  dateRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<Draft>) => void;
  onClearInvalid: (field: EntryField) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h3">{editing ? 'Edit entry' : 'New entry'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          aria-label={editing ? 'Edit entry' : 'New entry'}
          onSubmit={onSubmit}
          className="grid gap-4 md:grid-cols-2"
        >
          <fieldset className="flex flex-col gap-2 md:col-span-2">
            <legend className="mb-2 text-body-sm font-medium">Kind</legend>
            <div className="flex gap-4">
              {(['expense', 'income'] as const).map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="radio"
                    name="entry-kind"
                    value={kind}
                    checked={draft.kind === kind}
                    onChange={() => onChange({ kind, categoryId: '' })}
                    className="size-4 accent-primary"
                  />
                  {kindLabel[kind]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-date">Date</Label>
            <Input
              id="entry-date"
              ref={dateRef}
              type="date"
              required
              value={draft.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-amount">Amount (KRW)</Label>
            <Input
              id="entry-amount"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 12500"
              value={draft.amount}
              aria-invalid={invalid === 'amount' || undefined}
              aria-describedby={invalid === 'amount' ? 'entries-notice' : undefined}
              onChange={(event) => {
                onClearInvalid('amount');
                onChange({ amount: event.target.value });
              }}
            />
          </div>
          {draft.splits.length === 0 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-category">Category</Label>
              <select
                id="entry-category"
                className={selectClass}
                value={stale ? 'stale' : categoryId}
                aria-invalid={(invalid === 'category' && stale) || undefined}
                aria-describedby={
                  invalid === 'category'
                    ? 'entries-notice entry-category-hint'
                    : 'entry-category-hint'
                }
                onChange={(event) => {
                  onClearInvalid('category');
                  onChange({ categoryId: event.target.value });
                }}
              >
                {stale ? (
                  <option value="stale" disabled>
                    Choose again
                  </option>
                ) : null}
                <option value="">Uncategorized</option>
                {choices.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.hidden
                      ? `${categoryLabel(category.name)} (hidden)`
                      : categoryLabel(category.name)}
                  </option>
                ))}
              </select>
              <p id="entry-category-hint" className="text-caption text-muted-foreground">
                If left uncategorized, a matching classification rule sets the category
                automatically.
              </p>
              {draft.kind === 'expense' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    onChange({
                      splits: [
                        { categoryId: stale ? '' : categoryId, amount: '' },
                        { categoryId: '', amount: '' },
                      ],
                    })
                  }
                >
                  Split this payment
                </Button>
              ) : null}
            </div>
          ) : (
            <SplitEditor draft={draft} choices={choices} onChange={onChange} />
          )}
          {draft.kind === 'expense' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-payment-method">Paid with</Label>
              <select
                id="entry-payment-method"
                className={selectClass}
                value={draft.paymentMethod}
                onChange={(event) =>
                  onChange({ paymentMethod: event.target.value as PaymentMethod | '' })
                }
              >
                <option value="">Not set</option>
                {(Object.keys(paymentMethodLabel) as PaymentMethod[]).map((method) => (
                  <option key={method} value={method}>
                    {paymentMethodLabel[method]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-merchant">Merchant</Label>
            <Combobox
              id="entry-merchant"
              maxLength={50}
              autoComplete="off"
              placeholder="e.g. Starbucks Gangnam"
              value={draft.merchant}
              options={merchants}
              listLabel="Merchants used before"
              onValueChange={(merchant) => onChange({ merchant })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-memo">Note</Label>
            <Input
              id="entry-memo"
              maxLength={200}
              value={draft.memo}
              onChange={(event) => onChange({ memo: event.target.value })}
            />
          </div>
          <div className="flex gap-2 md:col-span-2">
            {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}
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
