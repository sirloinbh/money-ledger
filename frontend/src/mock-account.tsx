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

// #50 Mock trading account. Virtual won only, never added to the ledger or portfolio totals.
// One open account; resetting keeps the old one as a closed record (2026-11-03 decision).
// Orders, holdings and returns come with #52-#54.

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

/** The starting amount in won, or the Korean message for what is wrong. Mirrors the server rules. */
function parseAmount(text: string): { amount: number } | { message: string } {
  const digits = withoutThousands(text);
  if (!/^\d{1,12}$/.test(digits)) return { message: '시작 금액은 원 단위 정수로 입력하세요' };
  const amount = Number(digits);
  if (amount < 10_000) return { message: '시작 금액은 1만 원 이상이어야 합니다' };
  if (amount > 10_000_000_000) return { message: '시작 금액은 100억 원 이하로 입력하세요' };
  return { amount };
}

const grouped = (amount: number) => new Intl.NumberFormat('ko-KR').format(amount);

/** `refreshKey` changes after an order elsewhere on the page, so the cash shown is reloaded (#52). */
export function MockAccount({ refreshKey = 0 }: { refreshKey?: number } = {}) {
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
    load().catch((cause: unknown) => showError(cause, '모의투자 계좌를 불러오지 못했습니다'));
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
      showError(`${done}. 계좌를 새로 불러오지 못했습니다`);
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
      await reload(`${formatWon(result.amount)}으로 모의투자 계좌를 만들었습니다`);
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
      await reload(`계좌를 초기화했습니다. ${formatWon(result.amount)}으로 다시 시작합니다`);
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
        모의투자 금액은 가상 금액이라 가계부와 자산 포트폴리오 합계에 들어가지 않습니다. 시작 금액은
        1만 원부터 100억 원까지 정할 수 있습니다.
      </p>
      {state === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">모의투자 계좌를 불러오는 중입니다</p>
        )
      ) : account ? (
        <Card>
          <CardHeader>
            <CardTitle asHeading="h2" ref={accountTitle} tabIndex={-1} className="outline-none">
              모의투자 계좌
            </CardTitle>
            <CardDescription>{formatDateTime(account.createdAt)}에 시작했습니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
                <dt className="text-body-sm text-muted-foreground">현금 잔고</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatWon(account.cashKrw)}</dd>
              </div>
              <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
                <dt className="text-body-sm text-muted-foreground">시작 금액</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatWon(account.initialCashKrw)}
                </dd>
              </div>
            </dl>
            <section aria-labelledby="mock-reset-title" className="flex flex-col gap-3">
              <h3 id="mock-reset-title" className="text-body font-semibold">
                처음부터 다시 시작
              </h3>
              <p className="text-body-sm text-muted-foreground">
                초기화하면 지금 계좌는 이전 계좌로 보관되고, 입력한 금액으로 새 계좌를 시작합니다.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-col gap-2 sm:w-64">
                  <Label htmlFor="mock-reset-amount">새 시작 금액(원)</Label>
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
                  title="모의투자 계좌를 초기화할까요?"
                  description={`지금 계좌(현금 ${formatWon(account.cashKrw)})는 이전 계좌로 보관되고 다시 쓸 수 없습니다.${'amount' in resetParsed ? ` 새 계좌는 ${formatWon(resetParsed.amount)}으로 시작합니다.` : ''}`}
                  confirmLabel="초기화"
                  open={confirming}
                  onOpenChange={openConfirm}
                  onConfirm={() => reset(account)}
                  // Empty while the account card is shown, so focus goes back to the reset button. If the
                  // account is gone (404) the create form replaces the card and focus goes to its field.
                  returnFocusRef={createInput}
                  trigger={
                    <Button type="button" variant="outline">
                      초기화
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
            <CardTitle asHeading="h2">모의투자 계좌 만들기</CardTitle>
            <CardDescription>
              가상 투자금으로 계좌를 만듭니다. 계좌는 하나만 둘 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              aria-label="모의투자 계좌 만들기"
              onSubmit={(event) => void create(event)}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <div className="flex flex-col gap-2 sm:w-64">
                <Label htmlFor="mock-create-amount">시작 금액(원)</Label>
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
                {busy ? '만드는 중…' : '계좌 만들기'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {state && state.closedAccounts.length > 0 ? (
        <section aria-labelledby="mock-closed-title" className="flex flex-col gap-3">
          <h2 id="mock-closed-title">이전 계좌</h2>
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
                  시작 {formatWon(closed.initialCashKrw)} · 마지막 현금 {formatWon(closed.cashKrw)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
