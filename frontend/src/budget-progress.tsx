import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { MAX_WON_TEXT } from '../../shared/contract';
import { categoryLabel } from './category-label';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatWon, serviceToday, withoutThousands, wonFromDigits } from './format';
import { ledgerKeys, refreshLedger, usePagedRead } from './ledger-query';
import { useApiMutation } from './lib/query';
import { useNotice } from './lib/use-notice';
import { cn } from './lib/utils';
import { readSummaryMonth } from './summary-month';
import { monthLabel } from './trend-series';

// #42 Each expense category's budget for the summary's month and how much of it is spent. A month without its
// own budget carries on from the latest earlier one (decided 2026-11-10); saving here sets this month and the
// months after it that have none of their own. 0 or an empty field means no budget ("Not set").
// #61 The budget is also the overspending line (decided 2026-11-16): spending equal to it already counts. The
// server says which (`status`), and the spending review lists the categories that reached or passed it.

type Budget = {
  categoryId: number;
  name: string;
  hidden: boolean;
  spent: number;
  budget: number | null;
  /** The month the budget was saved for: this month, or an earlier one it carries on from. */
  budgetMonth: string | null;
  remaining: number | null;
  over: number | null;
  /** Spent as a percentage of the budget with one decimal, from the server: "112.5". */
  percent: string | null;
  /** From the server: reached (exactly the budget) and over are overspending. */
  status: 'unset' | 'within' | 'reached' | 'over';
};
type Budgets = { month: string; budgets: Budget[] };

/**
 * Digits, optionally with commas as thousands separators only ("1,00" is refused) → whole won; empty is 0 (no
 * budget). undefined when it is not one.
 */
function parseBudget(text: string) {
  const digits = withoutThousands(text);
  if (digits === '') return 0;
  return wonFromDigits(digits);
}

/** The spending reloads by itself when entries or categories change elsewhere on the page (`ledgerKey`, #213). */
export function BudgetProgress() {
  const [searchParams] = useSearchParams();
  const month = readSummaryMonth(searchParams, serviceToday());
  const { query, data, failed } = usePagedRead<Budgets>(
    ledgerKeys.budgets(month),
    `/api/ledger/budgets?month=${month}`,
  );
  const [editing, setEditing] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  const title = useRef<HTMLHeadingElement>(null);
  const editButtons = useRef(new Map<number, HTMLButtonElement>());
  const client = useQueryClient();
  const write = useApiMutation<unknown, { categoryId: number; month: string; amount: number }>(
    ({ categoryId, ...body }) => ({
      path: `/api/ledger/budgets/${categoryId}`,
      method: 'PUT',
      body,
    }),
  );
  const [saving, setSaving] = useState(false);

  // What is on the screen now, for a save that ends later: the month and the open form.
  const now = useRef({ month, editing });
  useEffect(() => {
    now.current = { month, editing };
  }, [month, editing]);

  // Edit opens the form: the amount field takes the focus.
  useEffect(() => {
    if (editing !== undefined) document.getElementById(`budget-${editing}`)?.focus();
  }, [editing]);

  // Another month: an open form would save into the month it no longer shows.
  const [formMonth, setFormMonth] = useState(month);
  if (formMonth !== month) {
    setFormMonth(month);
    setEditing(undefined);
    setInvalid(false);
    clear();
  }

  const startEdit = (budget: Budget) => {
    clear();
    setInvalid(false);
    setDraft(budget.budget === null ? '' : String(budget.budget));
    setEditing(budget.categoryId);
  };
  const stopEdit = (categoryId: number) => {
    setEditing(undefined);
    setInvalid(false);
    // The form goes away: put focus back on the row's Edit button, or on the title when the row went away
    // (a hidden category whose budget was just unset is no longer listed).
    requestAnimationFrame(() => (editButtons.current.get(categoryId) ?? title.current)?.focus());
  };

  const save = async (event: FormEvent, budget: Budget) => {
    event.preventDefault();
    if (saving) return;
    const amount = parseBudget(draft);
    if (amount === undefined) {
      setInvalid(true);
      showError(`Enter the budget as a whole number of won, from 0 to ${MAX_WON_TEXT}`);
      return;
    }
    setSaving(true);
    try {
      await write.mutateAsync({ categoryId: budget.categoryId, month, amount });
      // Saving a budget for a month from then on also changes the later months' rows: every month's budgets
      // reload (a month opened during the save too), and the save waits for the month on the screen, so focus
      // goes to the row as listed after it.
      await refreshLedger(client, ledgerKeys.budgets());
      showStatus(
        amount === 0
          ? `${categoryLabel(budget.name)} budget changed to not set from ${monthLabel(month)}`
          : `${categoryLabel(budget.name)} budget set to ${formatWon(amount)} from ${monthLabel(month)}`,
      );
      // The month shown has reloaded by now, so the focus goes to the row as it is listed after the save. Only
      // this save's own form closes and takes the focus back: if the user meanwhile opened another row or moved
      // to another month, that is left as it is.
      if (now.current.month === month && now.current.editing === budget.categoryId) {
        stopEdit(budget.categoryId);
      }
    } catch (cause) {
      showError(cause, 'Could not save the budget');
    } finally {
      setSaving(false);
    }
  };

  // While another month loads the previous one stays dimmed; if that load fails it is not shown at all.
  const shown = data;
  const loading = data !== undefined && data.month !== month;
  const retry = () => {
    title.current?.focus();
    void query.refetch();
  };

  return (
    <section aria-labelledby="budget-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="budget-title" ref={title} tabIndex={-1} className="outline-none">
          Budget by category
        </h2>
        <p className="text-body-sm text-muted-foreground">As of {monthLabel(month)}</p>
      </div>
      <Notice id="budget-notice" notice={notice.notice} />
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">Could not load the budgets.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Retry loading budgets"
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">Loading budgets</p>
        )
      ) : (
        <>
          <SpendingReview budgets={shown.budgets} month={shown.month} loading={loading} />
          <Card aria-busy={loading || undefined} className={cn(loading && 'opacity-60')}>
            <CardHeader>
              <CardTitle asHeading="h3">Budget usage</CardTitle>
            </CardHeader>
            <CardContent>
              {shown.budgets.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  There are no expense categories.
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {shown.budgets.map((budget) => (
                    <li
                      key={budget.categoryId}
                      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                    >
                      <BudgetRow
                        budget={budget}
                        // The rows are of shown.month; while another month loads they are not editable, so an
                        // old amount is never saved into the new month.
                        month={shown.month}
                        disabled={loading}
                        onEdit={() => startEdit(budget)}
                        editRef={(button) => {
                          if (button) editButtons.current.set(budget.categoryId, button);
                          else editButtons.current.delete(budget.categoryId);
                        }}
                      />
                      {editing === budget.categoryId ? (
                        <form
                          className="flex flex-col gap-2"
                          onSubmit={(event) => void save(event, budget)}
                        >
                          <Label htmlFor={`budget-${budget.categoryId}`}>
                            {categoryLabel(budget.name)} budget (KRW)
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              id={`budget-${budget.categoryId}`}
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder="e.g. 300000"
                              className="w-40"
                              value={draft}
                              aria-invalid={invalid || undefined}
                              aria-describedby={`budget-${budget.categoryId}-hint${invalid ? ' budget-notice' : ''}`}
                              onChange={(event) => {
                                setInvalid(false);
                                setDraft(event.target.value);
                              }}
                            />
                            <Button type="submit" size="sm" disabled={saving}>
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => stopEdit(budget.categoryId)}
                            >
                              Cancel
                            </Button>
                          </div>
                          <p
                            id={`budget-${budget.categoryId}-hint`}
                            className="text-body-sm text-muted-foreground"
                          >
                            Applies from {monthLabel(month)}. Leave empty or 0 for not set.
                          </p>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function BudgetRow({
  budget,
  month,
  disabled,
  onEdit,
  editRef,
}: {
  budget: Budget;
  month: string;
  disabled: boolean;
  onEdit: () => void;
  editRef: (button: HTMLButtonElement | null) => void;
}) {
  const name = shownName(budget);
  const over = budget.status === 'over';
  const flagged = overspent(budget);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-body-sm font-medium break-words">{name}</p>
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-body-sm tabular-nums">
            {budget.budget === null ? (
              <span className="text-muted-foreground">Not set</span>
            ) : (
              <>
                {formatWon(budget.spent)}
                <span className="text-muted-foreground"> / {formatWon(budget.budget)}</span>
              </>
            )}
          </p>
          <Button
            ref={editRef}
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Edit ${categoryLabel(budget.name)} budget`}
            disabled={disabled}
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
      </div>
      {budget.budget === null ? (
        <p className="text-body-sm text-muted-foreground">
          Spent {formatWon(budget.spent)} · set a budget to see progress
        </p>
      ) : (
        <>
          {/* The bar repeats the text next to it, so it is hidden from screen readers. */}
          <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', flagged && 'bg-destructive')}
              style={{
                width: `${Math.min(Number(budget.percent), 100)}%`,
                background: flagged ? undefined : 'var(--chart-series-1)',
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 text-body-sm">
            {flagged ? (
              <p className="flex items-center gap-1 font-medium text-destructive">
                <CircleAlert aria-hidden className="size-4" />
                {over
                  ? `${formatWon(budget.over ?? 0)} over (${budget.percent}%)`
                  : `Budget reached (${budget.percent}%)`}
              </p>
            ) : (
              <p className="text-muted-foreground tabular-nums">
                {formatWon(budget.remaining ?? 0)} left ({budget.percent}%)
              </p>
            )}
            {budget.budgetMonth !== month && budget.budgetMonth !== null ? (
              <p className="text-muted-foreground">
                Budget set in {monthLabel(budget.budgetMonth)}
              </p>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

const shownName = (budget: Budget) =>
  budget.hidden ? `${categoryLabel(budget.name)} (hidden)` : categoryLabel(budget.name);
const overspent = (budget: Budget) => budget.status === 'reached' || budget.status === 'over';

/** #61 The categories that reached or passed their budget this month, each with the reason in words. */
function SpendingReview({
  budgets,
  month,
  loading,
}: {
  budgets: Budget[];
  month: string;
  loading: boolean;
}) {
  const flagged = budgets.filter(overspent);
  const anySet = budgets.some((budget) => budget.status !== 'unset');
  return (
    <Card aria-busy={loading || undefined} className={cn(loading && 'opacity-60')}>
      <CardHeader>
        <CardTitle asHeading="h3">Spending review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {flagged.length > 0 ? (
          <>
            <p className="text-body-sm">
              {flagged.length === 1
                ? `1 category reached its budget in ${monthLabel(month)}.`
                : `${flagged.length} categories reached their budget in ${monthLabel(month)}.`}
            </p>
            <ul aria-label="Overspending" className="flex flex-col gap-2">
              {flagged.map((budget) => (
                <li key={budget.categoryId} className="flex items-start gap-2 text-body-sm">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="min-w-0 break-words">
                    <span className="font-medium">{shownName(budget)}</span>
                    {': '}
                    {budget.status === 'over'
                      ? `spent ${formatWon(budget.spent)} of a ${formatWon(budget.budget ?? 0)} budget, ${formatWon(budget.over ?? 0)} more (${budget.percent}%)`
                      : `spent ${formatWon(budget.spent)}, all of the ${formatWon(budget.budget ?? 0)} budget (${budget.percent}%)`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-body-sm text-muted-foreground">
            {anySet
              ? `No category has reached its budget in ${monthLabel(month)}.`
              : 'Set a budget for a category below to review its spending.'}
          </p>
        )}
        <p className="text-caption text-muted-foreground">
          Spending equal to the budget counts as overspending. Fixed costs are included.
        </p>
      </CardContent>
    </Card>
  );
}
