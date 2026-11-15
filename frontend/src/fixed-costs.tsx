import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { selectClass } from './entry-filters-state';
import { addDueOnce, fixedCostsPath } from './fixed-costs-api';
import { formatWon, serviceToday, withoutThousands } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { readSummaryMonth } from './summary-month';
import { monthLabel } from './trend-series';

// #43 Fixed costs (decisions 2026-11-15). Each item adds one expense entry a month on its day. The app adds the
// due entries when it opens, skipped months included. A variable item (electricity, gas, phone) is added as an
// estimate, the last confirmed amount, which the user confirms here with the actual bill.

type Category = { id: number; kind: 'income' | 'expense'; name: string; hidden: boolean };
type MonthEntry = { id: number; date: string; amount: number; estimated: boolean };
type FixedCost = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  variable: boolean;
  dayOfMonth: number;
  startMonth: string;
  active: boolean;
  entry: MonthEntry | null;
};
type FixedCosts = {
  month: string;
  fixedCosts: FixedCost[];
  totals: { fixed: number; other: number };
};

/** The five items the user keeps, as presets for the form. The category is matched by its default name. */
const presets: { name: string; category: string; variable: boolean }[] = [
  { name: 'Rent', category: '주거', variable: false },
  { name: 'Date savings account', category: '여가', variable: false },
  { name: 'Electricity', category: '주거', variable: true },
  { name: 'Gas', category: '주거', variable: true },
  { name: 'Phone', category: '통신', variable: true },
];

/** Digits with optional thousands commas → whole won; undefined when it is not one. */
function parseWon(text: string) {
  const digits = withoutThousands(text);
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

const dayText = (day: number) => (day >= 29 ? `day ${day} (or the last day)` : `day ${day}`);

type Draft = {
  name: string;
  categoryId: string;
  amount: string;
  variable: boolean;
  dayOfMonth: string;
  startMonth: string;
};

/**
 * `version` changes when entries change elsewhere on the page, so the totals reload. `onChange` runs after this
 * card adds or changes entries, so the other cards reload.
 */
export function FixedCostManager({
  version = 0,
  onChange,
}: {
  version?: number;
  onChange?: () => void;
}) {
  const [searchParams] = useSearchParams();
  const month = readSummaryMonth(searchParams, serviceToday());
  const [data, setData] = useState<FixedCosts | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [failed, setFailed] = useState(false);
  // undefined: no form; 'new': the add form; a number: editing that item.
  const [form, setForm] = useState<'new' | number | undefined>(undefined);
  const [confirming, setConfirming] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  const latest = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const [list, cats] = await Promise.all([
        requestJson<FixedCosts>(`${fixedCostsPath}?month=${month}`),
        requestJson<{ categories: Category[] }>('/api/ledger/categories'),
      ]);
      if (latest.current !== request) return;
      setData(list);
      setCategories(cats.categories.filter((category) => category.kind === 'expense'));
    } catch {
      if (latest.current === request) setFailed(true);
    }
  }, [month]);

  // The first load waits for the entries the app adds when it opens; if any were added, the page reloads too.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    void addDueOnce().then((added) => {
      if (added > 0) onChangeRef.current?.();
    });
  }, []);
  useEffect(() => {
    void addDueOnce().then(load);
  }, [load, version]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    if (saving) return false;
    setSaving(true);
    try {
      try {
        await work();
      } catch (cause) {
        showError(cause, 'Could not save the fixed cost');
        return false;
      }
      // The change is saved now, even if what follows fails: a retry must not add the item twice.
      // Saving may make an item due (a new one, or one started again): add it now, not at the next open.
      try {
        await requestJson(`${fixedCostsPath}/generate`, { method: 'POST' });
        showStatus(done);
      } catch {
        showError(
          `${done}. Could not add its entries yet; they are added the next time the app opens`,
        );
      }
      onChange?.();
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  };

  // A form that closes gives the focus back to the section title, so it does not drop to the page.
  const closeForm = () => {
    setForm(undefined);
    requestAnimationFrame(() => title.current?.focus());
  };

  const shown = data;
  return (
    <section aria-labelledby="fixed-costs-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fixed-costs-title" ref={title} tabIndex={-1} className="outline-none">
          Fixed costs
        </h2>
        <p className="text-body-sm text-muted-foreground">As of {monthLabel(month)}</p>
      </div>
      <p className="text-body-sm text-muted-foreground">
        Each fixed cost is added as an expense entry every month on its day. Amounts that change
        every month are added as an estimate for you to confirm.
      </p>
      <Notice id="fixed-costs-notice" notice={notice.notice} />
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">Could not load the fixed costs.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Retry loading fixed costs"
            onClick={() => {
              title.current?.focus();
              void load();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">Loading fixed costs</p>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle asHeading="h3">Spending in {monthLabel(month)}</CardTitle>
            <CardDescription>
              <span className="tabular-nums">Fixed costs {formatWon(shown.totals.fixed)}</span>
              {' · '}
              <span className="tabular-nums">Other spending {formatWon(shown.totals.other)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {shown.fixedCosts.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">There are no fixed costs yet.</p>
            ) : (
              <ul aria-label="Fixed costs" className="flex flex-col divide-y">
                {shown.fixedCosts.map((item) => (
                  <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    {form === item.id ? (
                      <FixedCostForm
                        item={item}
                        categories={categories}
                        month={month}
                        saving={saving}
                        onCancel={closeForm}
                        onSave={async (body) => {
                          const saved = await run(
                            () =>
                              requestJson(`${fixedCostsPath}/${item.id}`, {
                                method: 'PATCH',
                                body,
                              }),
                            `${body.name} updated. It applies to entries added from now on`,
                          );
                          if (saved) closeForm();
                        }}
                        onInvalid={(message) => showError(message)}
                      />
                    ) : (
                      <FixedCostRow
                        item={item}
                        disabled={saving}
                        confirming={confirming === item.id}
                        onEdit={() => {
                          clear();
                          setConfirming(undefined);
                          setForm(item.id);
                        }}
                        onToggle={() =>
                          void run(
                            () =>
                              requestJson(`${fixedCostsPath}/${item.id}`, {
                                method: 'PATCH',
                                body: { active: !item.active },
                              }),
                            item.active
                              ? `${item.name} stopped`
                              : `${item.name} started again from this month`,
                          )
                        }
                        onConfirmOpen={() => {
                          clear();
                          setForm(undefined);
                          setConfirming(item.id);
                        }}
                        onConfirmCancel={() => setConfirming(undefined)}
                        onConfirm={async (amount) => {
                          const saved = await run(
                            () =>
                              requestJson(`${fixedCostsPath}/${item.id}/months/${shown.month}`, {
                                method: 'PUT',
                                body: { amount },
                              }),
                            `${item.name} confirmed at ${formatWon(amount)}`,
                          );
                          if (saved) setConfirming(undefined);
                        }}
                        onInvalid={(message) => showError(message)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {form === 'new' ? (
              <FixedCostForm
                categories={categories}
                month={month}
                saving={saving}
                onCancel={closeForm}
                onSave={async (body) => {
                  const saved = await run(
                    () => requestJson(fixedCostsPath, { method: 'POST', body }),
                    `${body.name} added`,
                  );
                  if (saved) closeForm();
                }}
                onInvalid={(message) => showError(message)}
              />
            ) : (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clear();
                    setConfirming(undefined);
                    setForm('new');
                  }}
                >
                  Add fixed cost
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function FixedCostRow({
  item,
  disabled,
  confirming,
  onEdit,
  onToggle,
  onConfirmOpen,
  onConfirmCancel,
  onConfirm,
  onInvalid,
}: {
  item: FixedCost;
  disabled: boolean;
  confirming: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onConfirmOpen: () => void;
  onConfirmCancel: () => void;
  onConfirm: (amount: number) => Promise<void>;
  onInvalid: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const entry = item.entry;
  const inputId = `fixed-cost-${item.id}-actual`;
  // The form opens on the user's own click, so the field takes the focus.
  const actualInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (confirming) actualInput.current?.focus();
  }, [confirming]);

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseWon(draft);
    if (amount === undefined) {
      setInvalid(true);
      onInvalid('Enter the actual amount as a whole number of won');
      return;
    }
    await onConfirm(amount);
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium break-words">
            {item.name}
            {item.variable ? <Badge variant="outline">Variable</Badge> : null}
            {item.active ? null : <Badge variant="secondary">Stopped</Badge>}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {item.categoryName} · {dayText(item.dayOfMonth)} ·{' '}
            <span className="tabular-nums">{formatWon(item.amount)}</span>
            {item.variable ? ' first estimate' : ''}
          </p>
          <p className="text-body-sm">
            {entry === null ? (
              <span className="text-muted-foreground">No entry this month</span>
            ) : entry.estimated ? (
              <span>
                Estimate <span className="tabular-nums">{formatWon(entry.amount)}</span> on{' '}
                {entry.date} · needs the actual amount
              </span>
            ) : (
              <span>
                Added <span className="tabular-nums">{formatWon(entry.amount)}</span> on{' '}
                {entry.date}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {entry?.estimated && !confirming ? (
            <Button
              type="button"
              size="sm"
              aria-label={`Confirm ${item.name} amount`}
              disabled={disabled}
              onClick={() => {
                setDraft(String(entry.amount));
                setInvalid(false);
                onConfirmOpen();
              }}
            >
              Confirm amount
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Edit ${item.name}`}
            disabled={disabled}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={item.active ? `Stop ${item.name}` : `Start ${item.name} again`}
            disabled={disabled}
            onClick={onToggle}
          >
            {item.active ? 'Stop' : 'Start again'}
          </Button>
        </div>
      </div>
      {confirming ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => void confirm(event)}>
          <Label htmlFor={inputId}>{item.name} actual amount (KRW)</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={inputId}
              ref={actualInput}
              inputMode="numeric"
              autoComplete="off"
              className="w-40"
              value={draft}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'fixed-costs-notice' : undefined}
              onChange={(event) => {
                setInvalid(false);
                setDraft(event.target.value);
              }}
            />
            <Button type="submit" size="sm" disabled={disabled}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onConfirmCancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}

type SaveBody = {
  name: string;
  categoryId: number;
  amount: number;
  variable: boolean;
  dayOfMonth: number;
  startMonth?: string;
};

function FixedCostForm({
  item,
  categories,
  month,
  saving,
  onCancel,
  onSave,
  onInvalid,
}: {
  item?: FixedCost;
  categories: Category[];
  month: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (body: SaveBody) => Promise<void>;
  onInvalid: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    name: item?.name ?? '',
    categoryId: item ? String(item.categoryId) : '',
    amount: item ? String(item.amount) : '',
    variable: item?.variable ?? false,
    dayOfMonth: item ? String(item.dayOfMonth) : '',
    startMonth: item?.startMonth ?? month,
  }));
  const [invalid, setInvalid] = useState<keyof Draft | undefined>(undefined);
  const prefix = item ? `fixed-cost-${item.id}` : 'fixed-cost-new';
  const change = (next: Partial<Draft>) => {
    setInvalid(undefined);
    setDraft((current) => ({ ...current, ...next }));
  };
  // Hidden categories are offered only when the item already uses one.
  const choices = categories.filter(
    (category) => !category.hidden || String(category.id) === draft.categoryId,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const refuse = (field: keyof Draft, message: string) => {
      setInvalid(field);
      onInvalid(message);
      document.getElementById(`${prefix}-${field}`)?.focus();
    };
    const name = draft.name.trim();
    if (!name) return refuse('name', 'Enter a name');
    if (!draft.categoryId) return refuse('categoryId', 'Choose an expense category');
    const amount = parseWon(draft.amount);
    if (amount === undefined) return refuse('amount', 'Enter the amount as a whole number of won');
    const day = Number(draft.dayOfMonth);
    if (!/^\d{1,2}$/.test(draft.dayOfMonth) || day < 1 || day > 31) {
      return refuse('dayOfMonth', 'Enter a day between 1 and 31');
    }
    if (!item && !/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.startMonth)) {
      return refuse('startMonth', 'Enter the start month as YYYY-MM');
    }
    await onSave({
      name,
      categoryId: Number(draft.categoryId),
      amount,
      variable: draft.variable,
      dayOfMonth: day,
      ...(item ? {} : { startMonth: draft.startMonth }),
    });
  };

  const described = (field: keyof Draft) => (invalid === field ? 'fixed-costs-notice' : undefined);

  return (
    <form
      aria-label={item ? `Edit ${item.name}` : 'New fixed cost'}
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
    >
      {item ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm text-muted-foreground">Start from a common one</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.name}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const category = categories.find(
                    (choice) => choice.name === preset.category && !choice.hidden,
                  );
                  change({
                    name: preset.name,
                    variable: preset.variable,
                    categoryId: category ? String(category.id) : draft.categoryId,
                  });
                }}
              >
                {preset.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-name`}>Name</Label>
          <Input
            id={`${prefix}-name`}
            value={draft.name}
            maxLength={30}
            placeholder="e.g. Rent"
            aria-invalid={invalid === 'name' || undefined}
            aria-describedby={described('name')}
            onChange={(event) => change({ name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-categoryId`}>Category</Label>
          <select
            id={`${prefix}-categoryId`}
            className={selectClass}
            value={draft.categoryId}
            aria-invalid={invalid === 'categoryId' || undefined}
            aria-describedby={described('categoryId')}
            onChange={(event) => change({ categoryId: event.target.value })}
          >
            <option value="">Choose</option>
            {choices.map((category) => (
              <option key={category.id} value={category.id}>
                {category.hidden ? `${category.name} (hidden)` : category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-amount`}>
            {draft.variable ? 'First estimate (KRW)' : 'Amount (KRW)'}
          </Label>
          <Input
            id={`${prefix}-amount`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 500000"
            value={draft.amount}
            aria-invalid={invalid === 'amount' || undefined}
            aria-describedby={described('amount')}
            onChange={(event) => change({ amount: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-dayOfMonth`}>Day of the month</Label>
          <Input
            id={`${prefix}-dayOfMonth`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="1 to 31"
            value={draft.dayOfMonth}
            aria-invalid={invalid === 'dayOfMonth' || undefined}
            aria-describedby={`${prefix}-day-hint${invalid === 'dayOfMonth' ? ' fixed-costs-notice' : ''}`}
            onChange={(event) => change({ dayOfMonth: event.target.value })}
          />
          <p id={`${prefix}-day-hint`} className="text-caption text-muted-foreground">
            A day past the month&apos;s end uses the last day.
          </p>
        </div>
        {item ? null : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${prefix}-startMonth`}>Start month</Label>
            <Input
              id={`${prefix}-startMonth`}
              placeholder="YYYY-MM"
              autoComplete="off"
              value={draft.startMonth}
              aria-invalid={invalid === 'startMonth' || undefined}
              aria-describedby={`${prefix}-start-hint${invalid === 'startMonth' ? ' fixed-costs-notice' : ''}`}
              onChange={(event) => change({ startMonth: event.target.value })}
            />
            <p id={`${prefix}-start-hint`} className="text-caption text-muted-foreground">
              Months from here up to today are added when you save (at most 24 months back).
            </p>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-body-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={draft.variable}
          onChange={(event) => change({ variable: event.target.checked })}
        />
        The amount changes every month (confirm it each month)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {item ? 'Save' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
