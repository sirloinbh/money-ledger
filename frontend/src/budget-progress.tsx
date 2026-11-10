import { CircleAlert } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatWon, serviceToday, withoutThousands } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { cn } from './lib/utils';
import { readSummaryMonth } from './summary-month';
import { monthLabel } from './trend-series';

// #42 Each expense category's budget for the summary's month and how much of it is spent. A month without its
// own budget carries on from the latest earlier one (decided 2026-11-10); saving here sets this month and the
// months after it that have none of their own. 0 or an empty field means no budget ("미설정").

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
};
type Budgets = { month: string; budgets: Budget[] };

/**
 * Digits, optionally with commas as thousands separators only ("1,00" is refused) → whole won; empty is 0 (no
 * budget). undefined when it is not one.
 */
function parseBudget(text: string) {
  const digits = withoutThousands(text);
  if (digits === '') return 0;
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** `version` changes when entries or categories change elsewhere on the page, so the spending reloads. */
export function BudgetProgress({ version = 0 }: { version?: number }) {
  const [searchParams] = useSearchParams();
  const month = readSummaryMonth(searchParams, serviceToday());
  const [data, setData] = useState<Budgets | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  // Only the latest request may fill the list.
  const latest = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  const editButtons = useRef(new Map<number, HTMLButtonElement>());

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const next = await requestJson<Budgets>(`/api/ledger/budgets?month=${month}`);
      if (latest.current === request) setData(next);
    } catch {
      if (latest.current === request) setFailed(true);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load, version]);

  // A save started on one month may finish after the summary moved to another: it must reload the month shown
  // then, not the one it started on.
  const loadShown = useRef(load);
  useEffect(() => {
    loadShown.current = load;
  }, [load]);

  // 수정 opens the form: the amount field takes the focus.
  useEffect(() => {
    if (editing !== undefined) document.getElementById(`budget-${editing}`)?.focus();
  }, [editing]);

  // Another month: an open form would save into the month it no longer shows.
  const [formMonth, setFormMonth] = useState(month);
  if (formMonth !== month) {
    setFormMonth(month);
    setEditing(undefined);
    setInvalid(false);
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
    // The form goes away: put focus back on the row's 수정 button, or on the title when the row went away
    // (a hidden category whose budget was just unset is no longer listed).
    requestAnimationFrame(() => (editButtons.current.get(categoryId) ?? title.current)?.focus());
  };

  const save = async (event: FormEvent, budget: Budget) => {
    event.preventDefault();
    if (saving) return;
    const amount = parseBudget(draft);
    if (amount === undefined) {
      setInvalid(true);
      showError('예산은 0원 이상의 정수로 입력하세요');
      return;
    }
    setSaving(true);
    try {
      await requestJson(`/api/ledger/budgets/${budget.categoryId}`, {
        method: 'PUT',
        body: { month, amount },
      });
      showStatus(
        amount === 0
          ? `${budget.name} 예산을 ${monthLabel(month)}부터 미설정으로 바꿨습니다`
          : `${budget.name} 예산을 ${monthLabel(month)}부터 ${formatWon(amount)}으로 정했습니다`,
      );
      // Reload first, so the focus goes to the row as it is listed after the save.
      await loadShown.current();
      stopEdit(budget.categoryId);
    } catch (cause) {
      showError(cause, '예산을 저장하지 못했습니다');
    } finally {
      setSaving(false);
    }
  };

  // While another month loads the previous one stays dimmed; if that load fails it is not shown at all.
  const stale = data !== undefined && data.month !== month;
  const shown = failed && stale ? undefined : data;
  const loading = stale && !failed;
  const retry = () => {
    title.current?.focus();
    void load();
  };

  return (
    <section aria-labelledby="budget-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="budget-title" ref={title} tabIndex={-1} className="outline-none">
          카테고리별 예산
        </h2>
        <p className="text-body-sm text-muted-foreground">{monthLabel(month)} 기준</p>
      </div>
      <Notice id="budget-notice" notice={notice.notice} />
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm text-muted-foreground">예산을 불러오지 못했습니다.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="예산 다시 시도"
            onClick={retry}
          >
            다시 시도
          </Button>
        </div>
      ) : null}
      {shown === undefined ? (
        failed ? null : (
          <p className="text-body-sm text-muted-foreground">예산을 불러오는 중입니다</p>
        )
      ) : (
        <Card aria-busy={loading || undefined} className={cn(loading && 'opacity-60')}>
          <CardHeader>
            <CardTitle asHeading="h3">예산 사용률</CardTitle>
          </CardHeader>
          <CardContent>
            {shown.budgets.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">지출 카테고리가 없습니다.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {shown.budgets.map((budget) => (
                  <li
                    key={budget.categoryId}
                    className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <BudgetRow
                      budget={budget}
                      month={month}
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
                          {budget.name} 예산(원)
                        </Label>
                        <div className="flex flex-wrap gap-2">
                          <Input
                            id={`budget-${budget.categoryId}`}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="예: 300000"
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
                            저장
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => stopEdit(budget.categoryId)}
                          >
                            취소
                          </Button>
                        </div>
                        <p
                          id={`budget-${budget.categoryId}-hint`}
                          className="text-body-sm text-muted-foreground"
                        >
                          {monthLabel(month)}부터 적용됩니다. 비우거나 0이면 미설정입니다.
                        </p>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function BudgetRow({
  budget,
  month,
  onEdit,
  editRef,
}: {
  budget: Budget;
  month: string;
  onEdit: () => void;
  editRef: (button: HTMLButtonElement | null) => void;
}) {
  const name = budget.hidden ? `${budget.name} (숨김)` : budget.name;
  const over = (budget.over ?? 0) > 0;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-body-sm font-medium break-words">{name}</p>
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-body-sm tabular-nums">
            {budget.budget === null ? (
              <span className="text-muted-foreground">미설정</span>
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
            aria-label={`${budget.name} 예산 수정`}
            onClick={onEdit}
          >
            수정
          </Button>
        </div>
      </div>
      {budget.budget === null ? (
        <p className="text-body-sm text-muted-foreground">
          지출 {formatWon(budget.spent)} · 예산을 정하면 진행률이 보입니다
        </p>
      ) : (
        <>
          {/* The bar repeats the text next to it, so it is hidden from screen readers. */}
          <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', over && 'bg-destructive')}
              style={{
                width: `${Math.min(Number(budget.percent), 100)}%`,
                background: over ? undefined : 'var(--chart-series-1)',
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 text-body-sm">
            {over ? (
              <p className="flex items-center gap-1 font-medium text-destructive">
                <CircleAlert aria-hidden className="size-4" />
                {formatWon(budget.over ?? 0)} 초과 ({budget.percent}%)
              </p>
            ) : (
              <p className="text-muted-foreground tabular-nums">
                {formatWon(budget.remaining ?? 0)} 남음 ({budget.percent}%)
              </p>
            )}
            {budget.budgetMonth !== month && budget.budgetMonth !== null ? (
              <p className="text-muted-foreground">{monthLabel(budget.budgetMonth)}에 정한 예산</p>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
