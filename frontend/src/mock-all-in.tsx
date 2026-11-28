import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Notice } from './components/ui/notice';
import { formatWon, sharesOf } from './format';
import { formatDecimal } from './format';
import { RequestError, requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { mockKey } from './mock-query';
import { refreshReads } from './query-reads';

// #307 All-in buy of a Korean security at the best ask of the live order book (#305). The server finds the quantity
// (the most whole shares the cash covers with the buy fee), so nothing is computed here: this screen shows the
// preview it returns and sends back the ask it showed, so the order never fills at a price the person did not see.

type Preview = {
  security: { id: number; symbol: string; name: string | null };
  ask: string;
  readAt: string;
  quantity: string | null;
  amountKrw: number | null;
  feeKrw: number | null;
  cashKrw: number;
  cashAfterKrw: number | null;
  problem: string | null;
};
type Ready = Preview & {
  quantity: string;
  amountKrw: number;
  feeKrw: number;
  cashAfterKrw: number;
};

function readyOf(data: Preview): Ready | null {
  const { quantity, amountKrw, feeKrw, cashAfterKrw } = data;
  if (
    data.problem !== null ||
    quantity === null ||
    amountKrw === null ||
    feeKrw === null ||
    cashAfterKrw === null
  ) {
    return null;
  }
  return { ...data, quantity, amountKrw, feeKrw, cashAfterKrw };
}

/** A random (version 4) UUID, or null when the browser cannot make one. */
function newRequestKey(): string | null {
  const random = globalThis.crypto as Partial<Crypto> | undefined;
  if (typeof random?.randomUUID === 'function') return random.randomUUID();
  if (typeof random?.getRandomValues !== 'function') return null;
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function MockAllIn({ securityId, title }: { securityId: number; title: string }) {
  const client = useQueryClient();
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ accountId: number; data: Ready }>();
  const button = useRef<HTMLButtonElement>(null);
  // One key per review, kept while the same buy is retried after a lost answer.
  const requestKey = useRef<string | undefined>(undefined);

  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { account } = await requestJson<{ account: { id: number } | null }>(
        '/api/mock/accounts',
      );
      if (!account) {
        showError('Create a mock trading account first');
        return;
      }
      const data = await requestJson<Preview>(
        `/api/mock/accounts/${account.id}/positions/preview?securityId=${securityId}`,
      );
      const ready = readyOf(data);
      if (!ready) {
        showError(data.problem ?? 'Cannot place the order');
        return;
      }
      requestKey.current ??= newRequestKey() ?? undefined;
      if (!requestKey.current) {
        showError('This browser cannot create an order key, so the order cannot be placed');
        return;
      }
      notice.clear();
      setReview({ accountId: account.id, data: ready });
    } catch (cause) {
      showError(cause, 'Could not check the order');
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    if (!review || !requestKey.current) return;
    try {
      const placed = await requestJson<{ position: { quantity: string } }>(
        `/api/mock/accounts/${review.accountId}/positions`,
        {
          method: 'POST',
          body: { securityId, requestKey: requestKey.current, expectedAsk: review.data.ask },
        },
      );
      requestKey.current = undefined;
      setReview(undefined);
      showStatus(
        `Bought ${sharesOf(placed.position.quantity)} of ${title} at ${formatWon(Number(review.data.ask))}. Choose day trade or long hold in Positions`,
      );
      void refreshReads(client, mockKey);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status !== undefined && cause.status < 500) {
        requestKey.current = undefined;
        setReview(undefined);
        showError(cause, 'Could not place the order');
        throw cause;
      }
      showError(
        `${cause instanceof Error ? cause.message : 'Could not place the order'}. The order may have been filled, so check your positions`,
      );
      void refreshReads(client, mockKey);
      throw cause;
    }
  };

  const ready = review?.data;
  return (
    <section aria-label={`${title} all-in buy`} className="flex flex-col gap-2">
      <h3 className="text-body font-semibold">All-in buy</h3>
      <div>
        <Button
          ref={button}
          type="button"
          aria-busy={busy || undefined}
          onClick={() => void check()}
        >
          {busy ? 'Checking…' : 'Review all-in buy'}
        </Button>
      </div>
      <Notice id={`all-in-${securityId}-notice`} notice={notice.notice} />
      <ConfirmDialog
        title={ready ? `Buy ${sharesOf(ready.quantity)} of ${title}` : 'Review all-in buy'}
        description={
          ready ? (
            <span className="flex flex-col gap-1">
              <span>Fills at the best ask of ₩{formatDecimal(ready.ask)}.</span>
              <span>
                Amount {formatWon(ready.amountKrw)} · fee {formatWon(ready.feeKrw)}
              </span>
              <span>Cash after order {formatWon(ready.cashAfterKrw)}</span>
            </span>
          ) : undefined
        }
        confirmLabel="Buy all-in"
        destructive={false}
        open={review !== undefined}
        onOpenChange={(open) => {
          if (!open) setReview(undefined);
        }}
        onConfirm={place}
        returnFocusRef={button}
      />
    </section>
  );
}
