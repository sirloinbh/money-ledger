import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { EntryFilters } from './entry-filters';
import {
  apiQuery,
  type FilterCategory,
  type Kind,
  kindLabel,
  readFilters,
  selectClass,
  writeFilters,
} from './entry-filters-state';
import { formatWon, serviceToday } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { cn } from './lib/utils';

// #38 Income and expense entries: add, edit, delete.
// #39 The list is filtered by period, kind, category and search (kept in the address) and split into pages.
// #60 A merchant and an optional category: saved without one, the server applies the keyword rules.

type Category = FilterCategory;
type Entry = {
  id: number;
  date: string;
  kind: Kind;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string;
  memo: string;
};
type Draft = {
  date: string;
  kind: Kind;
  amount: string;
  categoryId: string;
  merchant: string;
  memo: string;
};

const entriesPath = '/api/ledger/entries';
const pageSize = 50;
/** One loaded page of the list, with the query it answers. */
type Listing = { query: string; entries: Entry[]; total: number };

const emptyDraft = (): Draft => ({
  date: serviceToday(),
  kind: 'expense',
  amount: '',
  categoryId: '',
  merchant: '',
  memo: '',
});

/** "12,500" or "12500" → 12500; anything else (sign, decimals, letters) → undefined. */
function parseAmount(text: string) {
  const digits = text.replaceAll(',', '').trim();
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * `categoriesVersion` changes when categories are edited elsewhere on the page, so the choices reload;
 * `entriesVersion` when entries are classified elsewhere, so the list reloads. `onChange` reports a save or delete.
 */
export function EntryManager({
  categoriesVersion = 0,
  entriesVersion = 0,
  onChange,
}: {
  categoriesVersion?: number;
  entriesVersion?: number;
  onChange?: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = serviceToday();
  // Memoized by the filter keys of the address only: the filter form compares by identity to notice a change,
  // and another key changing (the summary's `month`, #40) must not reset what is being typed.
  const filterSearch = writeFilters(readFilters(searchParams, today)).toString();
  const filters = useMemo(
    () => readFilters(new URLSearchParams(filterSearch), today),
    [filterSearch, today],
  );
  const query = apiQuery(filters, pageSize);
  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  // The filters the next load asks for.
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  // Only the latest request may fill the list. Numbered, not compared by filters: two loads of the same
  // filters (one started before a save, one after) may answer in either order.
  const latestRequest = useRef(0);
  // While the list for new filters loads, the previous one stays (marked busy) so the page and focus hold.
  const loading = listing !== undefined && listing.query !== query;
  const entries = listing?.entries;
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Entry | undefined>(undefined);
  // A save in flight: the ref blocks a second submit and edit/cancel, `busy` tells the user.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<'amount' | 'category' | undefined>(undefined);
  const dateInput = useRef<HTMLInputElement>(null);
  const sectionTitle = useRef<HTMLHeadingElement>(null);
  // Where the delete dialog returns focus: empty (back to its trigger) unless the delete went through.
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  // Always loads the filters current when it is called: a save or delete that ends after the filters changed
  // reloads the new list, not the one it started on.
  const loadEntries = useCallback(async () => {
    const asked = latestQuery.current;
    const request = ++latestRequest.current;
    setLoadFailed(false);
    try {
      const data = await requestJson<{ entries: Entry[]; total: number }>(
        `${entriesPath}?${asked}`,
      );
      if (latestRequest.current === request) setListing({ query: asked, ...data });
    } catch (cause) {
      if (latestRequest.current === request) setLoadFailed(true);
      throw cause;
    }
  }, []);

  // Set when this component reports its own change: it reloads by itself, so the version bump that follows
  // does not load the list a second time. The parent must pass back the version it bumps (LedgerPage does);
  // the flag is cleared by that one effect run.
  const skipReload = useRef(false);
  const notifyChange = () => {
    if (!onChange) return;
    skipReload.current = true;
    onChange();
  };

  // Also reloads after a category change elsewhere on the page: the list shows category names.
  useEffect(() => {
    if (skipReload.current) {
      skipReload.current = false;
      return;
    }
    loadEntries().catch((cause: unknown) => showError(cause, 'Could not load the entries'));
  }, [loadEntries, showError, categoriesVersion, entriesVersion, query]);

  useEffect(() => {
    requestJson<{ categories: Category[] }>('/api/ledger/categories')
      .then((data) => {
        setCategories(data.categories);
        setCategoriesLoaded(true);
      })
      .catch((cause: unknown) => showError(cause, 'Could not load the categories'));
  }, [categoriesVersion, showError]);

  // The entry being edited was classified elsewhere on the page (bulk classification): take over its new
  // category unless the user already picked another one, so saving does not undo the classification.
  useEffect(() => {
    if (!editing || !entries) return;
    const latest = entries.find((entry) => entry.id === editing.id);
    if (!latest || latest.categoryId === editing.categoryId) return;
    const before = editing.categoryId === null ? '' : String(editing.categoryId);
    const after = latest.categoryId === null ? '' : String(latest.categoryId);
    setEditing({ ...editing, categoryId: latest.categoryId, categoryName: latest.categoryName });
    setDraft((current) =>
      current.categoryId === before ? { ...current, categoryId: after } : current,
    );
    showStatus('The category of the entry being edited was changed elsewhere and has been applied');
  }, [entries, editing, showStatus]);

  // A page past the end (the last entry of the last page was deleted, or an old link): go to the last page.
  useEffect(() => {
    if (!listing || listing.query !== query || listing.entries.length > 0) return;
    const last = Math.max(1, Math.ceil(listing.total / pageSize));
    if (filters.page > last) {
      setSearchParams((prev) => writeFilters({ ...filters, page: last }, prev), { replace: true });
    }
  }, [listing, query, filters, setSearchParams]);

  // A category in the address that the filter cannot offer (unknown, or of the other kind) is dropped, so the
  // form and the list always show the same conditions.
  useEffect(() => {
    if (!categoriesLoaded || !/^\d+$/.test(filters.category)) return;
    const category = categories.find((c) => String(c.id) === filters.category);
    if (!category || (filters.kind && category.kind !== filters.kind)) {
      setSearchParams((prev) => writeFilters({ ...filters, category: '', page: 1 }, prev), {
        replace: true,
      });
    }
  }, [categoriesLoaded, categories, filters, setSearchParams]);

  // Visible categories of the chosen kind, plus the hidden one an edited entry already has.
  const choices = categories.filter(
    (category) =>
      category.kind === draft.kind && (!category.hidden || category.id === editing?.categoryId),
  );

  // A chosen category that is no longer offered (hidden meanwhile) must be chosen again: saving it as
  // Uncategorized without a word would drop the user's choice.
  // Judged only once the categories are loaded, so a slow or failed load does not flag every choice.
  const stale =
    categoriesLoaded &&
    draft.categoryId !== '' &&
    !choices.some((category) => String(category.id) === draft.categoryId);
  const categoryId = stale ? '' : draft.categoryId;

  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  // Opening an edit moves focus to the form above the list, so keyboard and screen reader users follow.
  // Keyed by id: taking over a category changed elsewhere must not move focus.
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId !== undefined) dateInput.current?.focus();
  }, [editingId]);

  const startEdit = (entry: Entry) => {
    if (saving.current) return;
    setInvalid(undefined);
    setEditing(entry);
    setDraft({
      date: entry.date,
      kind: entry.kind,
      amount: String(entry.amount),
      categoryId: entry.categoryId === null ? '' : String(entry.categoryId),
      merchant: entry.merchant,
      memo: entry.memo,
    });
    notice.clear();
  };

  const stopEdit = () => {
    setInvalid(undefined);
    setEditing(undefined);
    setDraft(emptyDraft());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseAmount(draft.amount);
    if (saving.current) return;
    if (amount === undefined) {
      setInvalid('amount');
      showError('Enter the amount as a whole number of won, 0 or more');
      return;
    }
    if (stale) {
      setInvalid('category');
      showError('The chosen category cannot be used. Choose a category again');
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    const body = {
      date: draft.date,
      kind: draft.kind,
      amount,
      // Empty is Uncategorized: the server fills it from a matching keyword rule, if any.
      categoryId: categoryId ? Number(categoryId) : null,
      merchant: draft.merchant,
      memo: draft.memo,
    };
    try {
      try {
        await (editing
          ? requestJson(`${entriesPath}/${editing.id}`, { method: 'PUT', body })
          : requestJson(entriesPath, { method: 'POST', body }));
      } catch (cause) {
        showError(cause);
        return;
      }
      notifyChange();
      const done = editing
        ? 'Entry updated'
        : `${kindLabel[draft.kind]} ${formatWon(amount)} recorded`;
      if (editing) {
        stopEdit();
      } else {
        // Keep the date and kind for the next entry of the same day.
        // Clear only what was sent: anything typed while saving stays.
        setDraft((current) =>
          current.amount === draft.amount &&
          current.memo === draft.memo &&
          current.merchant === draft.merchant
            ? { ...current, amount: '', merchant: '', memo: '' }
            : current,
        );
      }
      try {
        await loadEntries();
        showStatus(done);
      } catch {
        showError(`${done}. Could not reload the list`);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const remove = async (entry: Entry) => {
    if (saving.current) {
      showError('Saving in progress. Try again in a moment');
      throw new Error('saving'); // keeps the dialog open
    }
    try {
      await requestJson(`${entriesPath}/${entry.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      throw cause; // keeps the dialog open
    }
    notifyChange();
    afterDelete.current = sectionTitle.current;
    if (editing?.id === entry.id) stopEdit();
    try {
      await loadEntries();
      showStatus('Entry deleted');
    } catch {
      showError('Entry deleted. Could not reload the list');
    }
  };

  return (
    <section aria-labelledby="entries-title" className="flex flex-col gap-4">
      {/* Focus lands here after a delete: the deleted row held the dialog trigger. */}
      <h2 id="entries-title" ref={sectionTitle} tabIndex={-1} className="outline-none">
        Income and expense entries
      </h2>
      <Notice id="entries-notice" notice={notice.notice} />
      <Card>
        <CardHeader>
          <CardTitle asHeading="h3">{editing ? 'Edit entry' : 'New entry'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            aria-label={editing ? 'Edit entry' : 'New entry'}
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 md:grid-cols-2"
          >
            <fieldset className="flex flex-col gap-2 md:col-span-2">
              <legend className="mb-2 text-body-sm font-medium">Kind</legend>
              <div className="flex gap-4">
                {(['expense', 'income'] as const).map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-body-sm">
                    <input
                      type="radio"
                      name="entry-kind"
                      value={kind}
                      checked={draft.kind === kind}
                      onChange={() => change({ kind, categoryId: '' })}
                      className="size-4 accent-primary"
                    />
                    {kindLabel[kind]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-date">Date</Label>
              <Input
                id="entry-date"
                ref={dateInput}
                type="date"
                required
                value={draft.date}
                onChange={(event) => change({ date: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-amount">Amount (KRW)</Label>
              <Input
                id="entry-amount"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 12500"
                value={draft.amount}
                aria-invalid={invalid === 'amount' || undefined}
                aria-describedby={invalid === 'amount' ? 'entries-notice' : undefined}
                onChange={(event) => {
                  if (invalid === 'amount') setInvalid(undefined);
                  change({ amount: event.target.value });
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-category">Category</Label>
              <select
                id="entry-category"
                className={selectClass}
                value={stale ? 'stale' : categoryId}
                aria-invalid={(invalid === 'category' && stale) || undefined}
                aria-describedby={
                  invalid === 'category'
                    ? 'entries-notice entry-category-hint'
                    : 'entry-category-hint'
                }
                onChange={(event) => {
                  if (invalid === 'category') setInvalid(undefined);
                  change({ categoryId: event.target.value });
                }}
              >
                {stale ? (
                  <option value="stale" disabled>
                    Choose again
                  </option>
                ) : null}
                <option value="">Uncategorized</option>
                {choices.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.hidden ? `${category.name} (hidden)` : category.name}
                  </option>
                ))}
              </select>
              <p id="entry-category-hint" className="text-caption text-muted-foreground">
                If left uncategorized, a matching classification rule sets the category
                automatically.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-merchant">Merchant</Label>
              <Input
                id="entry-merchant"
                maxLength={50}
                autoComplete="off"
                placeholder="e.g. Starbucks Gangnam"
                value={draft.merchant}
                onChange={(event) => change({ merchant: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-memo">Note</Label>
              <Input
                id="entry-memo"
                maxLength={200}
                value={draft.memo}
                onChange={(event) => change({ memo: event.target.value })}
              />
            </div>
            <div className="flex gap-2 md:col-span-2">
              {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
              <Button type="submit" aria-busy={busy || undefined}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (!saving.current) stopEdit();
                  }}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <EntryFilters
        filters={filters}
        categories={categories}
        today={today}
        onApply={(next) => setSearchParams((prev) => writeFilters(next, prev))}
      />
      <EntryList
        entries={entries}
        loading={loading}
        total={listing?.total ?? 0}
        failed={loadFailed}
        onRetry={() =>
          void loadEntries().catch((cause: unknown) =>
            showError(cause, 'Could not load the entries'),
          )
        }
        page={filters.page}
        onPage={(page) => setSearchParams((prev) => writeFilters({ ...filters, page }, prev))}
        onEdit={startEdit}
        onDelete={remove}
        returnFocusRef={afterDelete}
        onDeleteOpen={() => {
          afterDelete.current = null;
        }}
      />
    </section>
  );
}

/** "2026-11-05 Food ₩12,500": names a row in button labels and the delete dialog. */
const entryLabel = (entry: Entry) =>
  `${entry.date} ${entry.categoryName ?? 'Uncategorized'} ${formatWon(entry.amount)}`;

function EntryList({
  entries,
  loading,
  total,
  failed,
  onRetry,
  page,
  onPage,
  onEdit,
  onDelete,
  returnFocusRef,
  onDeleteOpen,
}: {
  entries: Entry[] | undefined;
  /** The list shown is for the previous filters while the new one loads. */
  loading: boolean;
  total: number;
  failed: boolean;
  onRetry: () => void;
  page: number;
  onPage: (page: number) => void;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => Promise<void>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onDeleteOpen: () => void;
}) {
  // Shown above the previous list, which stays with its page buttons so focus is not lost.
  const failure = failed ? (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-body-sm text-muted-foreground">Could not load the entries.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  ) : null;
  if (entries === undefined) {
    if (failure) return failure;
    return <p className="text-body-sm text-muted-foreground">Loading entries</p>;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // aria-disabled, not disabled: a button that becomes unavailable on the last page keeps the focus.
  const pageButton = (label: string, target: number, available: boolean) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={!available || undefined}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onClick={() => {
        if (available) onPage(target);
      }}
    >
      {label}
    </Button>
  );
  const pager =
    pages > 1 || page > 1 ? (
      <nav aria-label="Entry pages" className="flex items-center justify-center gap-3">
        {pageButton('Previous page', Math.min(page - 1, pages), page > 1)}
        <span className="text-body-sm tabular-nums">
          Page {page} of {pages}
        </span>
        {pageButton('Next page', page + 1, page < pages)}
      </nav>
    ) : null;
  // After a failed load the previous list is not "loading" any more: the failure says what happened.
  const pending = loading && !failed;
  const status = failed ? null : (
    <p className="text-body-sm text-muted-foreground">
      {loading ? 'Loading…' : `${total} ${total === 1 ? 'entry' : 'entries'}`}
    </p>
  );
  if (entries.length === 0) {
    return (
      <div aria-busy={pending || undefined} className="flex flex-col gap-3">
        {failure}
        {pending ? status : null}
        <p className="text-body-sm text-muted-foreground">
          {total > 0 ? 'There are no entries on this page.' : 'No entries match the filters.'}
        </p>
        {pager}
      </div>
    );
  }
  return (
    <div aria-busy={pending || undefined} className="flex flex-col gap-3">
      {failure}
      {status}
      <ul
        aria-label="Entry list"
        className={cn('flex flex-col divide-y rounded-xl border', loading && 'opacity-60')}
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
                {entry.date}
                <Badge variant={entry.kind === 'income' ? 'success' : 'secondary'}>
                  {kindLabel[entry.kind]}
                </Badge>
                {entry.categoryName ?? 'Uncategorized'}
              </span>
              {entry.merchant || entry.memo ? (
                <span className="break-words">
                  {[entry.merchant, entry.memo].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium tabular-nums">
                {entry.kind === 'income' ? '+' : '-'}
                {formatWon(entry.amount)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Edit ${entryLabel(entry)}`}
                onClick={() => onEdit(entry)}
              >
                Edit
              </Button>
              <ConfirmDialog
                title="Delete this entry?"
                description={`${entryLabel(entry)}. Deleting it cannot be undone.`}
                onConfirm={() => onDelete(entry)}
                returnFocusRef={returnFocusRef}
                onOpenChange={(open) => {
                  if (open) onDeleteOpen();
                }}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${entryLabel(entry)}`}
                  >
                    Delete
                  </Button>
                }
              />
            </div>
          </li>
        ))}
      </ul>
      {pager}
    </div>
  );
}
