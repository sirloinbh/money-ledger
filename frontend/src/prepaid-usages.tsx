import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatWon, realDate, serviceToday, withoutThousands as digits } from './format';
import { RequestError, requestJson } from './lib/api';
import { errorText, useNotice } from './lib/use-notice';

// #64 Uses of a stored-value prepaid asset (voucher). Add and delete only (decision 2026-11-08); the server
// refuses a use larger than the balance or after the expiry date. A use is not a ledger expense: the
// payment already was one.

type Usage = { id: number; usedOn: string; amountKrw: number; memo: string };
type Field = 'usedOn' | 'amount';

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
    load().catch((cause: unknown) => showError(cause, 'Could not load the usage records'));
  }, [load, showError]);

  const refresh = async (done: string) => {
    try {
      await Promise.all([load(), onChanged()]);
      showStatus(done);
    } catch {
      showError(`${done}. Could not reload the list`);
    }
  };

  const fieldProps = (field: Field) => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? noticeId : undefined,
  });

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) {
      showError('Saving in progress. Try again in a moment');
      return;
    }
    if (!realDate(usedOn)) {
      setInvalid('usedOn');
      showError('Enter the date of use between 1900 and 2100');
      return;
    }
    // Same rule as the server: a use has already happened.
    if (usedOn > serviceToday()) {
      setInvalid('usedOn');
      showError('Usage dated after today cannot be recorded');
      return;
    }
    const plain = digits(amount);
    if (!/^\d{1,16}$/.test(plain) || Number(plain) < 1 || Number(plain) > 1e15) {
      setInvalid('amount');
      showError('Enter the amount used as a whole number of won, at least ₩1');
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
        // The balance, expiry and dates are checked on the server; its message says which. A refusal
        // about the date marks the date field, one about the balance the amount; others mark no field.
        const text = errorText(cause);
        const refused = cause instanceof RequestError && cause.status === 400;
        setInvalid(
          refused && text.includes('date')
            ? 'usedOn'
            : refused && text.includes('balance')
              ? 'amount'
              : undefined,
        );
        showError(cause);
        return;
      }
      setAmount('');
      setMemo('');
      await refresh(`${formatWon(Number(plain))} use recorded`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  // Called by the confirm dialog: rejecting keeps it open with the error shown.
  const remove = async (usage: Usage) => {
    if (saving.current) {
      showError('Saving in progress. Try again in a moment');
      throw new Error('saving');
    }
    saving.current = true;
    setBusy(true);
    try {
      await requestJson(`${path}/${usage.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      // Already gone (deleted elsewhere): show the list as it is now.
      if (cause instanceof RequestError && cause.status === 404) await load().catch(() => {});
      throw cause;
    } finally {
      saving.current = false;
      setBusy(false);
    }
    // The row and its button go away; the dialog returns focus to the panel title.
    afterDelete.current = title.current;
    await refresh(`${usage.usedOn} ${formatWon(usage.amountKrw)} usage record deleted`);
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
        {assetName} usage records
      </h4>
      <Notice id={noticeId} notice={notice.notice} />
      <form
        aria-label={`${assetName} add usage`}
        onSubmit={(event) => void add(event)}
        className="grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-date`}>Date used</Label>
          <Input
            id={`${prefix}-date`}
            type="date"
            min="1900-01-01"
            max={serviceToday()}
            value={usedOn}
            {...fieldProps('usedOn')}
            onChange={(event) => {
              if (invalid === 'usedOn') setInvalid(undefined);
              setUsedOn(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-amount`}>Amount used (KRW)</Label>
          <Input
            id={`${prefix}-amount`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 30000"
            value={amount}
            {...fieldProps('amount')}
            onChange={(event) => {
              if (invalid === 'amount') setInvalid(undefined);
              setAmount(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${prefix}-memo`}>Note</Label>
          <Input
            id={`${prefix}-memo`}
            maxLength={100}
            placeholder="e.g. Haircut"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </div>
        {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
        <Button type="submit" size="sm" aria-busy={busy || undefined}>
          {busy ? 'Saving…' : 'Add usage'}
        </Button>
      </form>
      {usages === undefined ? null : usages.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">No usage records yet.</p>
      ) : (
        <ul aria-label={`${assetName} usage list`} className="flex flex-col divide-y">
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
                  title="Delete this usage record?"
                  description={`${usage.usedOn} ${formatWon(usage.amountKrw)}. Deleting it adds that amount back to the balance.`}
                  confirmLabel="Delete"
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
                      aria-label={`Delete usage record ${usage.usedOn} ${formatWon(usage.amountKrw)}`}
                    >
                      Delete
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
