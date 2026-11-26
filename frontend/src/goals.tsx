import { type FormEvent, useState } from 'react';

import { MAX_WON_TEXT } from '../../shared/contract';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { selectClass } from './entry-filters-state';
import { formatWon, withoutThousands, wonFromDigits } from './format';
import type { Health } from './health';
import { apiKey, type ApiRequest, useApiMutation, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { Page } from './page';
import { portfolioKeys } from './portfolio-query';

// #297 Savings goals: a target amount, an optional target date, and progress from the monthly surplus or from one
// asset account. The server computes progress, the amount left and the monthly amount needed.

const goalsPath = '/api/goals';
const goalsKey = apiKey(goalsPath);

type Goal = {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  source: 'surplus' | 'asset';
  assetId: number | null;
  assetName: string | null;
  startMonth: string;
  finished: boolean;
  saved: number | null;
  remaining: number | null;
  percent: number | null;
  reached: boolean;
  overdue: boolean;
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  issue: 'no_asset' | 'no_value' | null;
};
type Asset = { id: number; name: string; type: string };

type Draft = {
  name: string;
  target: string;
  date: string;
  source: 'surplus' | 'asset';
  assetId: string;
};
type Body = {
  name: string;
  targetAmount: number;
  targetDate: string | null;
  source: Draft['source'];
  assetId: number | null;
};

const emptyDraft: Draft = { name: '', target: '', date: '', source: 'surplus', assetId: '' };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function GoalsPage({ health }: { health: Health }) {
  const goals = useApiQuery<{ goals: Goal[] }>(goalsKey, goalsPath);
  const assets = useApiQuery<{ assets: Asset[] }>(portfolioKeys.assets(), '/api/portfolio/assets');
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  // undefined: no form; 'new': the add form; a number: editing that goal.
  const [form, setForm] = useState<'new' | number | undefined>(undefined);
  const write = useApiMutation<unknown, ApiRequest>((request) => request, {
    invalidate: [goalsKey],
  });
  const accounts = (assets.data?.assets ?? []).filter((asset) => asset.type !== 'debt');

  const run = async (request: ApiRequest, done: string) => {
    try {
      await write.mutateAsync(request);
    } catch (cause) {
      showError(cause, 'Could not save the goal');
      return false;
    }
    showStatus(done);
    return true;
  };

  const list = goals.data?.goals;
  return (
    <Page title="Goals" description="Set a savings target and see how far you are" health={health}>
      <section aria-labelledby="goals-title" className="flex flex-col gap-4">
        <h2 id="goals-title">Savings goals</h2>
        <Notice id="goals-notice" notice={notice.notice} />
        {goals.isError && !goals.isFetching ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body-sm text-muted-foreground">Could not load the goals.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void goals.refetch()}>
              Try again
            </Button>
          </div>
        ) : list === undefined ? (
          <p className="text-body-sm text-muted-foreground">Loading goals</p>
        ) : (
          <>
            {list.length === 0 && form !== 'new' ? (
              <p className="text-body-sm text-muted-foreground">There are no goals yet.</p>
            ) : null}
            <ul aria-label="Goals" className="flex flex-col gap-4">
              {list.map((goal) => (
                <li key={goal.id}>
                  {form === goal.id ? (
                    <GoalForm
                      goal={goal}
                      accounts={accounts}
                      onCancel={() => setForm(undefined)}
                      onInvalid={(message) => showError(message)}
                      onSave={async (body) => {
                        const saved = await run(
                          { path: `${goalsPath}/${goal.id}`, method: 'PATCH', body },
                          `${body.name} updated`,
                        );
                        if (saved) setForm(undefined);
                      }}
                    />
                  ) : (
                    <GoalCard
                      goal={goal}
                      disabled={write.isPending}
                      onEdit={() => {
                        clear();
                        setForm(goal.id);
                      }}
                      onFinish={() =>
                        void run(
                          {
                            path: `${goalsPath}/${goal.id}`,
                            method: 'PATCH',
                            body: { finished: !goal.finished },
                          },
                          goal.finished ? `${goal.name} reopened` : `${goal.name} finished`,
                        )
                      }
                      onDelete={() =>
                        void run(
                          { path: `${goalsPath}/${goal.id}`, method: 'DELETE' },
                          `${goal.name} deleted`,
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
            {form === 'new' ? (
              <GoalForm
                accounts={accounts}
                onCancel={() => setForm(undefined)}
                onInvalid={(message) => showError(message)}
                onSave={async (body) => {
                  const saved = await run({ path: goalsPath, body }, `${body.name} added`);
                  if (saved) setForm(undefined);
                }}
              />
            ) : (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clear();
                    setForm('new');
                  }}
                >
                  Add goal
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </Page>
  );
}

function GoalCard({
  goal,
  disabled,
  onEdit,
  onFinish,
  onDelete,
}: {
  goal: Goal;
  disabled: boolean;
  onEdit: () => void;
  onFinish: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h3" className="flex flex-wrap items-center gap-2 break-words">
          {goal.name}
          {goal.finished ? <Badge variant="secondary">Finished</Badge> : null}
          {goal.reached && !goal.finished ? <Badge>Reached</Badge> : null}
          {goal.overdue ? <Badge variant="secondary">Past the target date</Badge> : null}
        </CardTitle>
        <CardDescription>
          Target <span className="tabular-nums">{formatWon(goal.targetAmount)}</span>
          {goal.targetDate ? ` by ${goal.targetDate}` : ''} ·{' '}
          {goal.source === 'surplus'
            ? `Monthly surplus since ${goal.startMonth}`
            : `Account: ${goal.assetName ?? 'none'}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {goal.saved === null ? (
          <p className="text-body-sm text-muted-foreground">
            {goal.issue === 'no_asset'
              ? 'The account was deleted. Edit the goal and choose another account.'
              : 'The account has no value yet (no price or exchange rate), so there is no progress to show.'}
          </p>
        ) : (
          <>
            <div
              role="progressbar"
              aria-label={`${goal.name} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={goal.percent ?? 0}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${goal.percent ?? 0}%` }} />
            </div>
            <p className="text-body-sm">
              <span className="tabular-nums">{formatWon(goal.saved)}</span> saved ({goal.percent}%)
              · <span className="tabular-nums">{formatWon(goal.remaining ?? 0)}</span> left
            </p>
            {goal.monthlyNeeded !== null ? (
              <p className="text-body-sm">
                Save <span className="tabular-nums">{formatWon(goal.monthlyNeeded)}</span> a month
                for {goal.monthsLeft} {goal.monthsLeft === 1 ? 'month' : 'months'} to reach it by
                the target date.
              </p>
            ) : null}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Edit ${goal.name}`}
            disabled={disabled}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={goal.finished ? `Reopen ${goal.name}` : `Finish ${goal.name}`}
            disabled={disabled}
            onClick={onFinish}
          >
            {goal.finished ? 'Reopen' : 'Finish'}
          </Button>
          {confirmingDelete ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                aria-label={`Confirm delete ${goal.name}`}
                disabled={disabled}
                onClick={onDelete}
              >
                Delete for good
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Delete ${goal.name}`}
              disabled={disabled}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalForm({
  goal,
  accounts,
  onCancel,
  onSave,
  onInvalid,
}: {
  goal?: Goal;
  accounts: Asset[];
  onCancel: () => void;
  onSave: (body: Body) => Promise<void>;
  onInvalid: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    goal
      ? {
          name: goal.name,
          target: String(goal.targetAmount),
          date: goal.targetDate ?? '',
          source: goal.source,
          assetId: goal.assetId === null ? '' : String(goal.assetId),
        }
      : emptyDraft,
  );
  const [saving, setSaving] = useState(false);
  const prefix = goal ? `goal-${goal.id}` : 'goal-new';
  const change = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const refuse = (field: string, message: string) => {
      onInvalid(message);
      document.getElementById(`${prefix}-${field}`)?.focus();
    };
    const name = draft.name.trim();
    if (!name) return refuse('name', 'Enter a name');
    const targetAmount = wonFromDigits(withoutThousands(draft.target));
    if (targetAmount === undefined || targetAmount < 1) {
      return refuse(
        'target',
        `Enter the target as a whole number of won from ₩1 to ${MAX_WON_TEXT}`,
      );
    }
    const date = draft.date.trim();
    if (date && !datePattern.test(date))
      return refuse('date', 'Enter the target date as YYYY-MM-DD');
    if (draft.source === 'asset' && !draft.assetId)
      return refuse('assetId', 'Choose an asset account');
    setSaving(true);
    try {
      await onSave({
        name,
        targetAmount,
        targetDate: date || null,
        source: draft.source,
        assetId: draft.source === 'asset' ? Number(draft.assetId) : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label={goal ? `Edit ${goal.name}` : 'New goal'}
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-name`}>Name</Label>
          <Input
            id={`${prefix}-name`}
            value={draft.name}
            maxLength={30}
            placeholder="e.g. Emergency fund"
            onChange={(event) => change({ name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-target`}>Target amount (KRW)</Label>
          <Input
            id={`${prefix}-target`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 6000000"
            value={draft.target}
            onChange={(event) => change({ target: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-date`}>Target date (optional)</Label>
          <Input
            id={`${prefix}-date`}
            placeholder="YYYY-MM-DD"
            autoComplete="off"
            value={draft.date}
            onChange={(event) => change({ date: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-source`}>Progress comes from</Label>
          <select
            id={`${prefix}-source`}
            className={selectClass}
            value={draft.source}
            onChange={(event) => change({ source: event.target.value as Draft['source'] })}
          >
            <option value="surplus">Monthly surplus (income minus spending)</option>
            <option value="asset">An asset account</option>
          </select>
        </div>
        {draft.source === 'asset' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${prefix}-assetId`}>Asset account</Label>
            <select
              id={`${prefix}-assetId`}
              className={selectClass}
              value={draft.assetId}
              onChange={(event) => change({ assetId: event.target.value })}
            >
              <option value="">Choose</option>
              {accounts.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {draft.source === 'surplus' ? (
        <p className="text-caption text-muted-foreground">
          {goal && goal.source === 'surplus'
            ? `Counted from ${goal.startMonth}.`
            : 'Counted from this month on, until today.'}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {goal ? 'Save' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
