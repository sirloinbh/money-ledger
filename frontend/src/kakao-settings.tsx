import { useEffect, useRef } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Notice } from './components/ui/notice';
import { formatDateTime } from './format';
import { apiKey, useApiMutation, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { useLoadError } from './query-reads';

// #311 Settings card: whether KakaoTalk (send to me) is connected, with Connect, Send test message and Disconnect.

type Status = {
  configured: boolean;
  state: 'not-configured' | 'disconnected' | 'connected' | 'revoked';
  connectedAt: string | null;
};

const kakaoPath = '/api/kakao';
const statusKey = apiKey(kakaoPath, 'status');

const stateText: Record<Status['state'], string> = {
  'not-configured': 'Not set up on the server yet. The Kakao keys are still missing.',
  disconnected: 'Not connected.',
  connected: 'Connected.',
  revoked: 'KakaoTalk access was revoked or expired. Reconnect to send messages again.',
};

export function KakaoSettings() {
  const read = useApiQuery<Status>(statusKey, `${kakaoPath}/status`);
  const { notice, status: showStatus, error: showError, clear } = useNotice();
  useLoadError(read.error, showError, 'Could not load the KakaoTalk status');
  const connect = useApiMutation<{ url: string }>(() => ({ path: `${kakaoPath}/connect` }));
  const test = useApiMutation<{ sent: boolean }>(() => ({ path: `${kakaoPath}/test` }), {
    invalidate: [statusKey],
  });
  const disconnect = useApiMutation<unknown>(
    () => ({ path: `${kakaoPath}/connection`, method: 'DELETE' }),
    { invalidate: [statusKey] },
  );
  const title = useRef<HTMLHeadingElement>(null);

  // The login returns here as /settings?kakao=connected|failed; say what happened once, then clean the address.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('kakao');
    if (!result) return;
    if (result === 'connected') showStatus('KakaoTalk connected');
    else showError('KakaoTalk could not be connected. Try again');
    window.history.replaceState(null, '', window.location.pathname);
  }, [showStatus, showError]);

  const state = read.data?.state;
  const busy = connect.isPending || test.isPending || disconnect.isPending;
  const connected = state === 'connected';

  const startLogin = async () => {
    clear();
    try {
      const { url } = await connect.mutateAsync(undefined);
      window.location.assign(url);
    } catch (cause) {
      showError(cause);
    }
  };

  const sendTest = async () => {
    clear();
    try {
      await test.mutateAsync(undefined);
      showStatus('Test message sent. Check KakaoTalk');
    } catch (cause) {
      showError(cause);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2" ref={title} tabIndex={-1} className="outline-none">
          KakaoTalk
        </CardTitle>
        <CardDescription>
          Mock investing reports and alerts are sent to your own KakaoTalk.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-body" data-state={state}>
          {state ? stateText[state] : 'Loading…'}
          {connected && read.data?.connectedAt
            ? ` Since ${formatDateTime(read.data.connectedAt)}.`
            : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {state === 'disconnected' || state === 'revoked' ? (
            <Button
              type="button"
              onClick={() => void startLogin()}
              aria-disabled={busy || undefined}
            >
              {state === 'revoked' ? 'Reconnect' : 'Connect'}
            </Button>
          ) : null}
          {connected ? (
            <>
              <Button
                type="button"
                onClick={() => void sendTest()}
                aria-disabled={busy || undefined}
              >
                Send test message
              </Button>
              <ConfirmDialog
                title="Disconnect KakaoTalk?"
                description="The stored KakaoTalk tokens are deleted. Reports stop until you connect again."
                confirmLabel="Disconnect"
                onConfirm={async () => {
                  try {
                    await disconnect.mutateAsync(undefined);
                    showStatus('KakaoTalk disconnected');
                  } catch (cause) {
                    showError(cause);
                    throw cause;
                  }
                }}
                returnFocusRef={title}
                trigger={
                  <Button type="button" variant="outline">
                    Disconnect
                  </Button>
                }
              />
            </>
          ) : null}
        </div>
        <Notice notice={notice} />
      </CardContent>
    </Card>
  );
}
