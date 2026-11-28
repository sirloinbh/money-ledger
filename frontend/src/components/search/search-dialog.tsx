// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/search/
import { SearchIcon } from 'lucide-react';
import type * as React from 'react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { plural } from '../../lib/format';
import { cn } from '../../lib/utils';
import { LoadFailed, LoadingRegion } from '../load-state/load-state';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import {
  matchesQuery,
  type SearchPage,
  type SearchResult,
  type SearchResultKind,
} from './search-match';

// One search over an app's menus, its pages and its content (#58). Menus and pages are matched here; content comes
// from the app's `searchContent(query, signal)`, which is debounced and cancelled when the query changes.
// Keyboard: the arrows move, Enter opens, Escape closes. The list follows the listbox pattern and the result count is
// announced politely.

export type SearchNavItem = { to: string; label: string };

export type SearchContent = (query: string, signal: AbortSignal) => Promise<SearchResult[]>;

const DEBOUNCE_MS = 250;

const GROUPS: { kind: SearchResultKind; label: string }[] = [
  { kind: 'menu', label: 'Menus' },
  { kind: 'page', label: 'Pages' },
  { kind: 'content', label: 'Content' },
];

type ContentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'done'; query: string; results: SearchResult[] };

function SearchDialog({
  open,
  onOpenChange,
  nav,
  pages,
  searchContent,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: SearchNavItem[];
  pages?: SearchPage[];
  searchContent?: SearchContent;
  /** Where focus goes when the dialog closes; the dialog has no trigger of its own, so the opener decides. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [content, setContent] = useState<ContentState>({ status: 'idle' });
  const [retry, setRetry] = useState(0);
  const trimmed = query.trim();

  // A closed dialog starts empty next time.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebounced('');
      setContent({ status: 'idle' });
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  useEffect(() => {
    if (!open || !searchContent || debounced === '') {
      setContent({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setContent({ status: 'loading' });
    searchContent(debounced, controller.signal).then(
      (results) => {
        if (!controller.signal.aborted) setContent({ status: 'done', query: debounced, results });
      },
      () => {
        if (!controller.signal.aborted) setContent({ status: 'failed' });
      },
    );
    return () => controller.abort();
  }, [open, searchContent, debounced, retry]);

  const local = useMemo<SearchResult[]>(() => {
    if (trimmed === '') return [];
    const menus = nav
      .filter((item) => matchesQuery(trimmed, item.label))
      .map((item): SearchResult => ({ title: item.label, href: item.to, kind: 'menu' }));
    const found = (pages ?? [])
      .filter((page) => matchesQuery(trimmed, page.title, ...(page.keywords ?? [])))
      .map((page): SearchResult => ({ title: page.title, href: page.path, kind: 'page' }));
    return [...menus, ...found];
  }, [trimmed, nav, pages]);

  // Content results count only while they answer the current query.
  const contentResults = useMemo<SearchResult[]>(
    () =>
      content.status === 'done' && content.query === trimmed
        ? content.results.map((r): SearchResult => ({ ...r, kind: 'content' }))
        : [],
    [content, trimmed],
  );
  const results = useMemo(() => [...local, ...contentResults], [local, contentResults]);

  useEffect(() => setActive(0), [results.length, trimmed]);

  const optionId = (index: number) => `${listId}-option-${index}`;
  const waiting =
    Boolean(searchContent) &&
    trimmed !== '' &&
    content.status !== 'failed' &&
    !(content.status === 'done' && content.query === trimmed);

  function choose(result: SearchResult) {
    onOpenChange(false);
    if (/^[a-z][a-z0-9+.-]*:/i.test(result.href) || result.href.startsWith('//'))
      window.location.assign(result.href);
    else void navigate(result.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[active];
      if (result) choose(result);
    }
  }

  const status =
    trimmed === ''
      ? ''
      : content.status === 'failed'
        ? 'Content search failed'
        : waiting
          ? 'Searching'
          : results.length === 0
            ? 'No results'
            : plural(results.length, 'result');

  let index = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        layout="full"
        className="sm:top-[20%] sm:translate-y-0"
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search the menus, pages and content of this app
        </DialogDescription>
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 focus-within:ring-[3px] focus-within:ring-ring/50">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            role="combobox"
            aria-label="Search this app"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search menus, pages and content"
            className="h-10 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground pointer-coarse:h-12"
          />
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto"
        >
          {GROUPS.map(({ kind, label }) => {
            const items = results.filter((r) => r.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} role="group" aria-label={label} className="flex flex-col gap-1">
                <p aria-hidden className="px-2 text-caption font-medium text-muted-foreground">
                  {label}
                </p>
                {items.map((result) => {
                  index += 1;
                  const current = index;
                  return (
                    // Focus stays in the input and the arrows move the highlight (combobox pattern), so options take no key events.
                    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/interactive-supports-focus -- aria-activedescendant pattern
                    <div
                      key={`${kind}-${result.href}-${current}`}
                      id={optionId(current)}
                      role="option"
                      aria-selected={current === active}
                      onMouseMove={() => setActive(current)}
                      onClick={() => choose(result)}
                      className={cn(
                        'flex min-h-10 cursor-pointer flex-col justify-center rounded-md px-3 py-1 text-body-sm pointer-coarse:min-h-12',
                        current === active && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span>{result.title}</span>
                      {result.snippet ? (
                        <span className="truncate text-caption text-muted-foreground">
                          {result.snippet}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {waiting ? <LoadingRegion label="Searching content" rows={2} /> : null}
        {content.status === 'failed' && trimmed !== '' ? (
          <LoadFailed message="Content search failed." onRetry={() => setRetry((n) => n + 1)} />
        ) : null}
        {trimmed !== '' && results.length === 0 && !waiting && content.status !== 'failed' ? (
          <p className="px-2 text-body-sm text-muted-foreground">No results for “{trimmed}”.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export { SearchDialog };
