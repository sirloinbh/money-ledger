import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { formatDateTime, formatDecimal, formatWon, sharesOf } from './format';
import { requestJson } from './lib/api';
import { apiKey, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { mockKey, mockKeys } from './mock-query';
import { refreshReads, useLoadError } from './query-reads';

// #307 Positions bought all-in at the best ask. A new position is "undecided" until the strategy is chosen: day
// trade (sold by a rule, #309) or long hold (asked again each morning, #310). Amounts come from the server.

type Strategy = 'undecided' | 'day_trade' | 'long_hold';
type Position = {
  id: number;
  security: { id: number; symbol: string; name: string | null };
  quantity: string;
  strategy: Strategy;
  strategyChosenAt: string | null;
  strategySource: string | null;
  openedAt: string;
  closedAt: string | null;
  buy: { price: string; amountKrw: number; feeKrw: number };
  sell: { price: string; amountKrw: number; feeKrw: number; taxKrw: number } | null;
};

const strategyNames: Record<Strategy, string> = {
  undecided: 'Undecided',
  day_trade: 'Day trade',
  long_hold: 'Long hold',
};
const nameOf = (position: Position) => position.security.name ?? position.security.symbol;

function PositionRow({
  position,
  busy,
  choose,
}: {
  position: Position;
  busy: boolean;
  choose: (position: Position, strategy: 'day_trade' | 'long_hold') => void;
}) {
  const title = nameOf(position);
  return (
    <li
      aria-label={title}
      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium">{title}</span>
          <Badge variant={position.strategy === 'undecided' ? 'outline' : 'secondary'}>
            {strategyNames[position.strategy]}
          </Badge>
        </div>
        <p className="text-body-sm text-muted-foreground">
          {sharesOf(position.quantity)} bought at ₩{formatDecimal(position.buy.price)} ·{' '}
          {formatWon(position.buy.amountKrw)} + fee {formatWon(position.buy.feeKrw)}
        </p>
        {position.sell ? (
          <p className="text-body-sm text-muted-foreground">
            Sold at ₩{formatDecimal(position.sell.price)} · {formatWon(position.sell.amountKrw)} −
            fee {formatWon(position.sell.feeKrw)} − tax {formatWon(position.sell.taxKrw)}
          </p>
        ) : position.strategyChosenAt ? (
          <p className="text-body-sm text-muted-foreground">
            Chosen {formatDateTime(position.strategyChosenAt)}
            {position.strategySource ? ` (${position.strategySource})` : ''}
          </p>
        ) : null}
      </div>
      {position.closedAt === null && position.strategy === 'undecided' ? (
        <div role="group" aria-label={`${title} strategy`} className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            aria-disabled={busy || undefined}
            onClick={() => choose(position, 'day_trade')}
          >
            Day trade
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-disabled={busy || undefined}
            onClick={() => choose(position, 'long_hold')}
          >
            Long hold
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** The open positions and the latest sold ones of the open mock account. Reloads with every mock change (#213). */
export function MockPositions() {
  const client = useQueryClient();
  const accounts = useApiQuery<{ account: { id: number } | null }>(
    mockKeys.accounts(),
    '/api/mock/accounts',
  );
  const accountId = accounts.data?.account?.id;
  const read = useApiQuery<{ positions: Position[] }>(
    apiKey('/api/mock', 'accounts', accountId, 'positions'),
    `/api/mock/accounts/${accountId}/positions`,
    { enabled: accountId !== undefined },
  );
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  useLoadError(read.error, showError, 'Could not load the positions');
  const [busy, setBusy] = useState(false);

  if (accountId === undefined) return null;
  const positions = read.data?.positions ?? [];
  const open = positions.filter((position) => position.closedAt === null);
  const sold = positions.filter((position) => position.closedAt !== null);

  const choose = async (position: Position, strategy: 'day_trade' | 'long_hold') => {
    if (busy) return;
    setBusy(true);
    try {
      await requestJson(`/api/mock/positions/${position.id}/strategy`, {
        method: 'POST',
        body: { strategy, source: 'web' },
      });
      showStatus(`${nameOf(position)}: ${strategyNames[strategy].toLowerCase()} chosen`);
    } catch (cause) {
      showError(cause, 'Could not save the strategy');
    } finally {
      setBusy(false);
      void refreshReads(client, mockKey);
    }
  };

  return (
    <Card aria-labelledby="mock-positions-title">
      <CardHeader>
        <CardTitle asHeading="h2" id="mock-positions-title">
          Positions
        </CardTitle>
        <CardDescription>
          All-in buys at the best ask. Choose day trade or long hold for each new position.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Notice id="mock-positions-notice" notice={notice.notice} />
        {read.isPending ? (
          <p className="text-body-sm text-muted-foreground">Loading positions</p>
        ) : positions.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No positions yet. Use All-in buy on a security to open one.
          </p>
        ) : (
          <>
            <ul aria-label="Open positions" className="flex flex-col gap-2">
              {open.map((position) => (
                <PositionRow
                  key={position.id}
                  position={position}
                  busy={busy}
                  choose={(p, s) => void choose(p, s)}
                />
              ))}
            </ul>
            {sold.length > 0 ? (
              <>
                <h4 className="text-body-sm font-semibold">Sold</h4>
                <ul aria-label="Sold positions" className="flex flex-col gap-2">
                  {sold.map((position) => (
                    <PositionRow
                      key={position.id}
                      position={position}
                      busy={busy}
                      choose={(p, s) => void choose(p, s)}
                    />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
