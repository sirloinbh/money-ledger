import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatDateTime, formatWon, withoutThousands } from './format';
import { RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { MockHistory } from './mock-history';
import { MockHoldings } from './mock-holdings';
import { MockReturns } from './mock-returns';

// #50 Mock trading account. Virtual won only, never added to the ledger or portfolio totals.
// One open account; resetting keeps the old one as a closed record (2026-11-03 decision).
// Holdings and returns (#53) show inside the account card; orders are placed from a security's detail (#52).

type Account = {
  id: number;
  initialCashKrw: number;
  cashKrw: number;
  createdAt: string;
  closedAt: string | null;
};
type State = { account: Account | null; closedAccounts: Account[] };

const accountsPath = '/api/mock/accounts';
const defaultAmount = '10,000,000';

/** The starting amount in won, or the message for what is wrong. Mirrors the server rules. */
function parseAmount(text: string): { amount: number } | { message: string } {
  const digits = withoutThousands(text);
  if (!/^\d{1,12}$/.test(digits))
    return { message: 'Enter the starting amount as a whole number of won' };
  const amount = Number(digits);
  if (amount < 10_000) return { message: 'The starting amount must be at least ₩10,000' };
  if (amount > 10_000_000_000) return { message: 'Enter a starting amount of ₩10 billion or less' };
  return { amount };
}

const grouped = (amount: number) => new Intl.NumberFormat('en-US').format(amount);

/**
 * `refreshKey` changes after an order elsewhere on the page, so the cash shown is reloaded (#52). `onOrdered`
 * is called after an order from a holding (#53), so the page bumps the key.
 */
export function MockAccount({
  refreshKey = 0,
  onOrdered = () => undefined,
}: { refreshKey?: number; onOrdered?: () => void } = {}) {
  const [state, setState] = useState<State | undefined>(undefined);
  const [createAmount, setCreateAmount] = useState(defaultAmount);
  const [resetAmount, setResetAmount] = useState(defaultAmount);
  const [invalid, setInvalid] = useState<'create' | 'reset' | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const accountTitle = useRef<HTMLHeadingElement>(null);
  const createInput = useRef<HTMLInputElement>(null);
  // Set before a reload that may swap the form for the account card or back.
  const refocus = useRef(false);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  const load = useCallback(async () => {
    const data = await requestJson<State>(accountsPath);
    setState(data);
    if (data.account) setResetAmount(grouped(data.account.initialCashKrw));
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, 'Could not load the mock trading account'));
  }, [load, showError, refreshKey]);

  // When a reload removes the focused control (the create button, the reset button), focus goes to what
  // replaced it: the account heading, or the amount field of the create form.
  useEffect(() => {
    if (!state || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    (state.account ? accountTitle.current : createInput.current)?.focus();
  }, [state]);

  const reload = async (done: string) => {
    try {
      await load();
      showStatus(done);
    } catch {
      showError(`${done}. Could not reload the account`);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const result = parseAmount(createAmount);
    if ('message' in result) {
      setInvalid('create');
      showError(result.message);
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    try {
      try {
        await requestJson(accountsPath, {
          method: 'POST',
          body: { initialCashKrw: result.amount },
        });
      } catch (cause) {
        showError(cause);
        // Another tab may have created the account already: show what the server has.
        refocus.current = true;
        await load().catch(() => undefined);
        return;
      }
      refocus.current = true;
      await reload(`Mock trading account created with ${formatWon(result.amount)}`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  // Checked before the dialog opens, so the dialog only ever confirms a valid amount.
  const openConfirm = (open: boolean) => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const result = parseAmount(resetAmount);
    if ('message' in result) {
      setInvalid('reset');
      showError(result.message);
      return;
    }
    setInvalid(undefined);
    notice.clear();
    setConfirming(true);
  };

  const reset = async (account: Account) => {
    const result = parseAmount(resetAmount);
    if ('message' in result || saving.current) throw new Error('not ready'); // keeps the dialog open
    saving.current = true;
    try {
      try {
        await requestJson(`${accountsPath}/${account.id}/reset`, {
          method: 'POST',
          body: { initialCashKrw: result.amount },
        });
      } catch (cause) {
        showError(cause);
        // Already reset elsewhere (409) or gone (404): show the account the server has now.
        if (cause instanceof RequestError && (cause.status === 409 || cause.status === 404)) {
          // The dialog was about the old account; closing it keeps a second press from resetting the new one.
          setConfirming(false);
          refocus.current = true;
          await load().catch(() => undefined);
        }
        throw cause;
      }
      await reload(`Account reset. Starting over with ${formatWon(result.amount)}`);
    } finally {
      saving.current = false;
    }
  };

  const fieldProps = (field: 'create' | 'reset') => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? 'mock-account-notice' : 'mock-account-amount-hint',
  });

  const account = state?.account;
  const resetParsed = parseAmount(resetAmount);

  return (
    <div className="flex flex-col gap-6">
      <Notice id="mock-account-notice" notice={notice.notice} />
      <p id="mock-account-amount-hint" className="text-caption text-muted-foreground">
        Mock trading money is virtual, so it is not part of the ledger or asset portfolio totals.
        The starting amount can be set from ₩10,000 to ₩10 billion.
      </p>
      {state === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">Loading the mock trading account</p>
        )
      ) : account ? (
        <Card>
          <CardHeader>
            <CardTitle asHeading="h2" ref={accountTitle} tabIndex={-1} className="outline-none">
              Mock trading account
            </CardTitle>
            <CardDescription>Started on {formatDateTime(account.createdAt)}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
                <dt className="text-body-sm text-muted-foreground">Cash balance</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatWon(account.cashKrw)}</dd>
              </div>
              <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
                <dt className="text-body-sm text-muted-foreground">Starting amount</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatWon(account.initialCashKrw)}
                </dd>
              </div>
            </dl>
            {/* Keyed by account, so an open order form and its state never carry over to a reset account. */}
            <MockHoldings
              key={account.id}
              accountId={account.id}
              refreshKey={refreshKey}
              onOrdered={onOrdered}
            />
            <section aria-labelledby="mock-reset-title" className="flex flex-col gap-3">
              <h3 id="mock-reset-title" className="text-body font-semibold">
                Start over
              </h3>
              <p className="text-body-sm text-muted-foreground">
                Resetting keeps the current account as a previous account and starts a new one with
                the amount you enter.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-col gap-2 sm:w-64">
                  <Label htmlFor="mock-reset-amount">New starting amount (KRW)</Label>
                  <Input
                    id="mock-reset-amount"
                    inputMode="numeric"
                    autoComplete="off"
                    value={resetAmount}
                    {...fieldProps('reset')}
                    onChange={(event) => {
                      if (invalid === 'reset') setInvalid(undefined);
                      setResetAmount(event.target.value);
                    }}
                  />
                </div>
                <ConfirmDialog
                  title="Reset the mock trading account?"
                  description={`The current account (cash ${formatWon(account.cashKrw)}) is kept as a previous account and can no longer be used.${'amount' in resetParsed ? ` The new account starts with ${formatWon(resetParsed.amount)}.` : ''}`}
                  confirmLabel="Reset"
                  open={confirming}
                  onOpenChange={openConfirm}
                  onConfirm={() => reset(account)}
                  // Empty while the account card is shown, so focus goes back to the reset button. If the
                  // account is gone (404) the create form replaces the card and focus goes to its field.
                  returnFocusRef={createInput}
                  trigger={
                    <Button type="button" variant="outline">
                      Reset
                    </Button>
                  }
                />
              </div>
            </section>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle asHeading="h2">Create a mock trading account</CardTitle>
            <CardDescription>
              Create an account with virtual money. You can have only one account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              aria-label="Create a mock trading account"
              onSubmit={(event) => void create(event)}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <div className="flex flex-col gap-2 sm:w-64">
                <Label htmlFor="mock-create-amount">Starting amount (KRW)</Label>
                <Input
                  id="mock-create-amount"
                  ref={createInput}
                  inputMode="numeric"
                  autoComplete="off"
                  value={createAmount}
                  {...fieldProps('create')}
                  onChange={(event) => {
                    if (invalid === 'create') setInvalid(undefined);
                    setCreateAmount(event.target.value);
                  }}
                />
              </div>
              {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
              <Button type="submit" aria-busy={busy || undefined}>
                {busy ? 'Creating…' : 'Create account'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {account ? (
        // #54 Only the open account's return and orders are shown; keyed so a reset starts them over.
        <>
          <MockReturns
            key={`returns-${account.id}`}
            accountId={account.id}
            refreshKey={refreshKey}
          />
          <MockHistory
            key={`history-${account.id}`}
            accountId={account.id}
            refreshKey={refreshKey}
          />
        </>
      ) : null}
      {state && state.closedAccounts.length > 0 ? (
        <section aria-labelledby="mock-closed-title" className="flex flex-col gap-3">
          <h2 id="mock-closed-title">Previous accounts</h2>
          <ul
            aria-labelledby="mock-closed-title"
            className="flex flex-col divide-y rounded-xl border"
          >
            {state.closedAccounts.map((closed) => (
              <li key={closed.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span className="text-body-sm text-muted-foreground">
                  {formatDateTime(closed.createdAt)} ~{' '}
                  {closed.closedAt ? formatDateTime(closed.closedAt) : ''}
                </span>
                <span className="text-body-sm tabular-nums">
                  Started with {formatWon(closed.initialCashKrw)} · last cash{' '}
                  {formatWon(closed.cashKrw)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
