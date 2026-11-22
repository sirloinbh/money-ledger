import type { FormEvent, RefObject } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { kindLabel, selectClass } from './entry-filters-state';
import type { Category, Draft, Entry } from './entry-model';

// #190 The new and edit entry form. The draft, the wrong field, and saving stay with EntryManager.

export type EntryField = 'amount' | 'category';

export function EntryForm({
  draft,
  editing,
  invalid,
  busy,
  choices,
  stale,
  categoryId,
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
                  {category.hidden ? `${category.name} (hidden)` : category.name}
                </option>
              ))}
            </select>
            <p id="entry-category-hint" className="text-caption text-muted-foreground">
              If left uncategorized, a matching classification rule sets the category automatically.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-merchant">Merchant</Label>
            <Input
              id="entry-merchant"
              maxLength={50}
              autoComplete="off"
              placeholder="e.g. Starbucks Gangnam"
              value={draft.merchant}
              onChange={(event) => onChange({ merchant: event.target.value })}
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
