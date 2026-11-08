import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatWon, serviceToday, withoutThousands as digits } from './format';
import { RequestError, requestJson } from './lib/api';
import { errorText, useNotice } from './lib/use-notice';

// #64 Uses of a stored-value prepaid asset (금액권). Add and delete only (decision 2026-11-08); the server
// refuses a use larger than the balance or after the expiry date. A use is not a ledger expense: the
// payment already was one.

type Usage = { id: number; usedOn: string; amountKrw: number; memo: string };
type Field = 'usedOn' | 'amount';

/** A real YYYY-MM-DD date between 1900 and 2100 (the server's range). */
function realDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text < '1900-01-01' || text > '2100-12-31') return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

export function PrepaidUsages({
  assetId,
  assetName,
  onChanged,
}: {
  assetId: number;
  assetName: string;
  /** Reloads the asset list so the balance and totals follow the change. */
  onChanged: () => Promise<void>;
}) {
  const [usages, setUsages] = useState<Usage[] | undefined>(undefined);
  const [usedOn, setUsedOn] = useState(serviceToday);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [invalid, setInvalid] = useState<Field | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  // Where the delete dialog returns focus: empty (back to its trigger) unless the delete went through.
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  const path = `/api/portfolio/assets/${assetId}/usages`;
  const noticeId = `usages-${assetId}-notice`;

  const load = useCallback(async () => {
    const data = await requestJson<{ usages: Usage[] }>(path);
    setUsages(data.usages);
  }, [path]);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, '사용 기록을 불러오지 못했습니다'));
  }, [load, showError]);

  const refresh = async (done: string) => {
    try {
      await Promise.all([load(), onChanged()]);
      showStatus(done);
    } catch {
      showError(`${done}. 목록을 새로 불러오지 못했습니다`);
    }
  };

  const fieldProps = (field: Field) => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? noticeId : undefined,
  });

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    if (!realDate(usedOn)) {
      setInvalid('usedOn');
      showError('사용한 날짜를 1900년부터 2100년 사이로 입력하세요');
      return;
    }
    const plain = digits(amount);
    if (!/^\d{1,16}$/.test(plain) || Number(plain) < 1 || Number(plain) > 1e15) {
      setInvalid('amount');
      showError('사용 금액은 1원 이상의 원 단위 정수로 입력하세요');
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    try {
      try {
        await requestJson(path, {
          method: 'POST',
          body: { usedOn, amountKrw: Number(plain), memo },
        });
      } catch (cause) {
        // The balance, expiry and future dates are checked on the server; its Korean message says which,
        // and a message about the date marks the date field.
        setInvalid(errorText(cause).includes('날짜') ? 'usedOn' : 'amount');
        showError(cause);
        return;
      }
      setAmount('');
      setMemo('');
      await refresh(`${formatWon(Number(plain))} 사용을 기록했습니다`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  // Called by the confirm dialog: rejecting keeps it open with the error shown.
  const remove = async (usage: Usage) => {
    if (saving.current) {
      showError('저장 중입니다. 잠시 후 다시 시도하세요');
      throw new Error('saving');
    }
    saving.current = true;
    try {
      await requestJson(`${path}/${usage.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      // Already gone (deleted elsewhere): show the list as it is now.
      if (cause instanceof RequestError && cause.status === 404) await load().catch(() => {});
      throw cause;
    } finally {
      saving.current = false;
    }
    // The row and its button go away; the dialog returns focus to the panel title.
    afterDelete.current = title.current;
    await refresh(`${usage.usedOn} ${formatWon(usage.amountKrw)} 사용 기록을 지웠습니다`);
  };

  const prefix = `usage-${assetId}`;
  return (
    <section
      aria-labelledby={`${prefix}-title`}
      className="flex w-full flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <h4
        id={`${prefix}-title`}
        ref={title}
        tabIndex={-1}
        className="text-body-sm font-semibold outline-none"
      >
        {assetName} 사용 기록
      </h4>
      <Notice id={noticeId} notice={notice.notice} />
      <form
        aria-label={`${assetName} 사용 추가`}
        onSubmit={(event) => void add(event)}
        className="grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-date`}>사용한 날짜</Label>
          <Input
            id={`${prefix}-date`}
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={usedOn}
            {...fieldProps('usedOn')}
            onChange={(event) => {
              if (invalid === 'usedOn') setInvalid(undefined);
              setUsedOn(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-amount`}>사용 금액(원)</Label>
          <Input
            id={`${prefix}-amount`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="예: 30000"
            value={amount}
            {...fieldProps('amount')}
            onChange={(event) => {
              if (invalid === 'amount') setInvalid(undefined);
              setAmount(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-memo`}>메모</Label>
          <Input
            id={`${prefix}-memo`}
            maxLength={100}
            placeholder="예: 커트"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </div>
        {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
        <Button type="submit" size="sm" aria-busy={busy || undefined}>
          {busy ? '저장 중…' : '사용 추가'}
        </Button>
      </form>
      {usages === undefined ? null : usages.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">아직 사용 기록이 없습니다.</p>
      ) : (
        <ul aria-label={`${assetName} 사용 내역`} className="flex flex-col divide-y">
          {usages.map((usage) => (
            <li key={usage.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-body-sm break-words">
                {usage.usedOn}
                {usage.memo ? ` · ${usage.memo}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-body-sm font-medium tabular-nums">
                  {formatWon(usage.amountKrw)}
                </span>
                <ConfirmDialog
                  title="사용 기록을 지울까요?"
                  description={`${usage.usedOn} ${formatWon(usage.amountKrw)}. 지우면 잔액이 그만큼 늘어납니다.`}
                  confirmLabel="지우기"
                  onConfirm={() => remove(usage)}
                  returnFocusRef={afterDelete}
                  onOpenChange={(open) => {
                    // Back to the trigger unless the delete went through.
                    if (open) afterDelete.current = null;
                  }}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${usage.usedOn} ${formatWon(usage.amountKrw)} 사용 기록 지우기`}
                    >
                      지우기
                    </Button>
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
