import { type KeyboardEvent, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { requestJson } from './lib/api';
import { errorText } from './lib/use-notice';
import { formatClose, type Quote, quoteBasis, securityText } from './quote-format';

// #47 Links a stock asset to a security from the shared price API (#51), so the asset is valued at the stored
// close. Optional: an unlinked asset takes a price entered by hand (decision 2026-11-10). Lives inside the
// asset form, so Enter in the search box searches instead of saving the asset.

export type LinkedSecurity = {
  id: number;
  market: string;
  symbol: string;
  name: string | null;
  currency: 'KRW' | 'USD';
  active: boolean;
};
type Found = LinkedSecurity & { quote: Quote | null };

type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'message'; text: string }
  | { state: 'done'; securities: Found[] };

export function SecurityPicker({
  value,
  onChange,
  locked = false,
}: {
  value: LinkedSecurity | null;
  onChange: (security: LinkedSecurity | null) => void;
  /** An asset with trades keeps its currency, so only a security in that currency fits. */
  locked?: 'KRW' | 'USD' | false;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const unlink = useRef<HTMLButtonElement>(null);

  const find = async () => {
    const q = query.trim();
    if (!q) {
      setSearch({ state: 'message', text: '검색어를 입력하세요' });
      return;
    }
    const call = ++latest.current;
    setSearch({ state: 'loading' });
    try {
      const data = await requestJson<{ securities: Found[] }>(
        `/api/prices/securities?q=${encodeURIComponent(q)}`,
      );
      if (call !== latest.current) return;
      const fitting = locked
        ? data.securities.filter((security) => security.currency === locked)
        : data.securities;
      setSearch(
        fitting.length === 0
          ? { state: 'message', text: '검색 결과가 없습니다' }
          : { state: 'done', securities: fitting },
      );
    } catch (cause) {
      if (call === latest.current) {
        setSearch({ state: 'message', text: errorText(cause, '종목을 찾지 못했습니다') });
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void find();
  };

  if (value) {
    return (
      <div className="flex flex-col gap-2 md:col-span-2">
        <span className="text-body-sm font-medium">연결한 종목</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-sm break-words">
            {securityText(value)}
            {value.active ? '' : ' · 거래 중단'}
          </span>
          <Button
            ref={unlink}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${value.name ?? value.symbol} 연결 해제`}
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            연결 해제
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">
          받은 종가로 평가합니다. 통화는 종목의 통화를 따릅니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <Label htmlFor="asset-security-query">종목 연결(선택)</Label>
      <div className="flex gap-2">
        <Input
          id="asset-security-query"
          ref={input}
          autoComplete="off"
          placeholder="이름·코드, 미국은 티커"
          value={query}
          aria-describedby="asset-security-hint"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" variant="outline" onClick={() => void find()}>
          찾기
        </Button>
      </div>
      <p id="asset-security-hint" className="text-caption text-muted-foreground">
        종목을 연결하면 받은 종가로 평가합니다. 연결하지 않으면 현재가를 직접 넣을 수 있습니다.
      </p>
      <div aria-live="polite" className="text-body-sm text-muted-foreground">
        {search.state === 'loading'
          ? '찾는 중입니다'
          : search.state === 'message'
            ? search.text
            : search.state === 'done'
              ? `${search.securities.length}개를 찾았습니다`
              : ''}
      </div>
      {search.state === 'done' ? (
        <ul aria-label="종목 검색 결과" className="flex flex-col divide-y rounded-xl border">
          {search.securities.map((security) => (
            <li
              key={security.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 text-body-sm break-words">
                {securityText(security)}
                {security.quote
                  ? ` · ${formatClose(security.quote)} (${quoteBasis(security.quote)})`
                  : ' · 아직 받은 종가가 없습니다'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`${security.name ?? security.symbol} 연결`}
                onClick={() => {
                  onChange({
                    id: security.id,
                    market: security.market,
                    symbol: security.symbol,
                    name: security.name,
                    currency: security.currency,
                    active: security.active,
                  });
                  setSearch({ state: 'idle' });
                  setQuery('');
                  requestAnimationFrame(() => unlink.current?.focus());
                }}
              >
                연결
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
