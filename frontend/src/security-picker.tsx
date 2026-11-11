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
      setSearch({ state: 'message', text: 'Enter a search term' });
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
          ? { state: 'message', text: 'No results' }
          : { state: 'done', securities: fitting },
      );
    } catch (cause) {
      if (call === latest.current) {
        setSearch({ state: 'message', text: errorText(cause, 'Could not find securities') });
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
        <span className="text-body-sm font-medium">Linked security</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-sm break-words">
            {securityText(value)}
            {value.active ? '' : ' · Trading halted'}
          </span>
          <Button
            ref={unlink}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Unlink ${value.name ?? value.symbol}`}
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            Unlink
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">
          Valued at the received close. The currency follows the security.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <Label htmlFor="asset-security-query">Link a security (optional)</Label>
      <div className="flex gap-2">
        <Input
          id="asset-security-query"
          ref={input}
          autoComplete="off"
          placeholder="Name or code; ticker for US"
          value={query}
          aria-describedby="asset-security-hint"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" variant="outline" onClick={() => void find()}>
          Find
        </Button>
      </div>
      <p id="asset-security-hint" className="text-caption text-muted-foreground">
        Linking a security values the asset at the received close. Without one you can enter the
        current price yourself.
      </p>
      <div aria-live="polite" className="text-body-sm text-muted-foreground">
        {search.state === 'loading'
          ? 'Searching'
          : search.state === 'message'
            ? search.text
            : search.state === 'done'
              ? `Found ${search.securities.length}`
              : ''}
      </div>
      {search.state === 'done' ? (
        <ul
          aria-label="Security search results"
          className="flex flex-col divide-y rounded-xl border"
        >
          {search.securities.map((security) => (
            <li
              key={security.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 text-body-sm break-words">
                {securityText(security)}
                {security.quote
                  ? ` · ${formatClose(security.quote)} (${quoteBasis(security.quote)})`
                  : ' · No close received yet'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Link ${security.name ?? security.symbol}`}
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
                Link
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
