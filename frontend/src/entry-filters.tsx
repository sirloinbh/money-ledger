import { type FormEvent, useState } from 'react';

import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  type FilterCategory,
  type Filters,
  kindLabel,
  monthRange,
  periodLabel,
  selectClass,
  shiftMonth,
} from './entry-filters-state';

// #39 The filter form above the entry list; what the filters mean is in entry-filters-state.ts.

/** The month the period starts in, or this month when it has no start. */
const baseMonth = (filters: Filters, today: string) => (filters.from || today).slice(0, 7);

export function EntryFilters({
  filters,
  categories,
  today,
  onApply,
}: {
  filters: Filters;
  categories: FilterCategory[];
  today: string;
  onApply: (filters: Filters) => void;
}) {
  // What is typed is applied with Apply; the month buttons and Reset apply at once.
  const [draft, setDraft] = useState(filters);
  const [applied, setApplied] = useState(filters);
  const [invalid, setInvalid] = useState(false);
  // The address changed (month button, back button, a save elsewhere): show what is applied.
  if (applied !== filters) {
    setApplied(filters);
    setDraft(filters);
    setInvalid(false);
  }

  const change = (patch: Partial<Filters>) => {
    setInvalid(false);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const apply = (next: Filters) => onApply({ ...next, page: 1 });
  const goMonth = (month: string) => apply({ ...draft, ...monthRange(month) });
  // The address may already hold these values, so the form clears what is typed itself.
  const reset = () => {
    const defaults: Filters = {
      ...monthRange(today.slice(0, 7)),
      kind: '',
      category: '',
      q: '',
      page: 1,
    };
    setDraft(defaults);
    setInvalid(false);
    apply(defaults);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setInvalid(true);
      return;
    }
    apply(draft);
  };

  const choices = categories.filter((category) => !draft.kind || category.kind === draft.kind);
  const month = baseMonth(filters, today);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-heading-sm font-semibold">
          {periodLabel(filters)}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goMonth(shiftMonth(month, -1))}
          >
            Previous month
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goMonth(today.slice(0, 7))}
          >
            This month
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goMonth(shiftMonth(month, 1))}
          >
            Next month
          </Button>
        </div>
      </div>
      <form
        aria-label="Entry filters"
        onSubmit={submit}
        className="grid grid-cols-2 gap-3 rounded-xl border p-4 lg:grid-cols-6"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-from">Start date</Label>
          <Input
            id="filter-from"
            type="date"
            value={draft.from}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? 'filter-error' : undefined}
            onChange={(event) => change({ from: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-to">End date</Label>
          <Input
            id="filter-to"
            type="date"
            value={draft.to}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? 'filter-error' : undefined}
            onChange={(event) => change({ to: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-kind">Kind</Label>
          <select
            id="filter-kind"
            className={selectClass}
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as Filters['kind'];
              // A category of the other kind would match nothing.
              const keep =
                !kind ||
                draft.category === '' ||
                draft.category === 'none' ||
                categories.some((c) => String(c.id) === draft.category && c.kind === kind);
              change({ kind, category: keep ? draft.category : '' });
            }}
          >
            <option value="">All</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-category">Category</Label>
          <select
            id="filter-category"
            className={selectClass}
            value={draft.category}
            onChange={(event) => change({ category: event.target.value })}
          >
            <option value="">All</option>
            <option value="none">Uncategorized</option>
            {choices.map((category) => (
              <option key={category.id} value={category.id}>
                {[
                  category.name,
                  draft.kind ? '' : `(${kindLabel[category.kind]})`,
                  category.hidden ? '(hidden)' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-2">
          <Label htmlFor="filter-q">Search</Label>
          <Input
            id="filter-q"
            type="search"
            maxLength={50}
            placeholder="Merchant or note"
            value={draft.q}
            onChange={(event) => change({ q: event.target.value })}
          />
        </div>
        {invalid ? (
          <p id="filter-error" role="alert" className="col-span-full text-body-sm text-destructive">
            Start date is after the end date
          </p>
        ) : null}
        <div className="col-span-full flex gap-2">
          <Button type="submit">Apply</Button>
          <Button type="button" variant="ghost" onClick={reset}>
            Reset
          </Button>
        </div>
      </form>
    </div>
  );
}
