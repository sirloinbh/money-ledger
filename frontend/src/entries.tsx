import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Notice } from './components/ui/notice';
import { EntryCsv } from './entry-csv';
import { EntryFilters } from './entry-filters';
import { apiQuery, kindLabel, writeFilters } from './entry-filters-state';
import { type EntryField, EntryForm } from './entry-form';
import {
  useAddressFilters,
  useEntryCategories,
  useEntryListing,
  useFilterCleanup,
} from './entry-hooks';
import { EntryList } from './entry-list';
import {
  categoryChoice,
  type Draft,
  draftFromEntry,
  emptyDraft,
  entriesPath,
  type Entry,
  pageSize,
  parseAmount,
} from './entry-model';
import { formatWon, serviceToday } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { useOwnChange } from './lib/use-own-change';

// #38 Income and expense entries: add, edit, delete.
// #39 The list is filtered by period, kind, category and search (kept in the address) and split into pages.
// #60 A merchant and an optional category: saved without one, the server applies the keyword rules.
// #190 Types and pure helpers are in entry-model.ts, the list and category loading in entry-hooks.ts, the form
// in entry-form.tsx, and the list in entry-list.tsx.

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
  const today = serviceToday();
  const { filters, setSearchParams } = useAddressFilters(today);
  const query = apiQuery(filters, pageSize);
  const { listing, loadFailed, loadEntries } = useEntryListing(query);
  // While the list for new filters loads, the previous one stays (marked busy) so the page and focus hold.
  const loading = listing !== undefined && listing.query !== query;
  const entries = listing?.entries;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Entry | undefined>(undefined);
  // A save in flight: the ref blocks a second submit and edit/cancel, `busy` tells the user.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<EntryField | undefined>(undefined);
  const dateInput = useRef<HTMLInputElement>(null);
  const sectionTitle = useRef<HTMLHeadingElement>(null);
  // Where the delete dialog returns focus: empty (back to its trigger) unless the delete went through.
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  // A save or delete here reloads the list by itself, so the version bump it reports skips one reload (#198).
  const { notifyChange, takeSkip } = useOwnChange(
    onChange,
    `${categoriesVersion}:${entriesVersion}`,
  );
  // The filters the last effect run loaded: new filters always load, even right after an own change.
  const effectQuery = useRef<string | undefined>(undefined);

  // Also reloads after a category change elsewhere on the page: the list shows category names.
  useEffect(() => {
    const newFilters = effectQuery.current !== query;
    effectQuery.current = query;
    if (takeSkip() && !newFilters) return;
    loadEntries().catch((cause: unknown) => showError(cause, 'Could not load the entries'));
  }, [loadEntries, showError, takeSkip, categoriesVersion, entriesVersion, query]);

  const { categories, loaded: categoriesLoaded } = useEntryCategories(categoriesVersion, showError);

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

  useFilterCleanup({ listing, query, filters, categories, categoriesLoaded, setSearchParams });

  const { choices, stale, categoryId } = categoryChoice(
    categories,
    categoriesLoaded,
    draft,
    editing?.categoryId,
  );
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
    setDraft(draftFromEntry(entry));
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
    // Blocks a save, an edit and a second delete until this one is done.
    saving.current = true;
    try {
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
    } finally {
      saving.current = false;
    }
  };

  return (
    <section aria-labelledby="entries-title" className="flex flex-col gap-4">
      {/* Focus lands here after a delete: the deleted row held the dialog trigger. */}
      <h2 id="entries-title" ref={sectionTitle} tabIndex={-1} className="outline-none">
        Income and expense entries
      </h2>
      <Notice id="entries-notice" notice={notice.notice} />
      <EntryForm
        draft={draft}
        editing={editing}
        invalid={invalid}
        busy={busy}
        choices={choices}
        stale={stale}
        categoryId={categoryId}
        dateRef={dateInput}
        onChange={change}
        onClearInvalid={(field) => {
          if (invalid === field) setInvalid(undefined);
        }}
        onSubmit={(event) => void submit(event)}
        onCancel={() => {
          if (!saving.current) stopEdit();
        }}
      />
      <EntryFilters
        filters={filters}
        categories={categories}
        today={today}
        onApply={(next) => setSearchParams((prev) => writeFilters(next, prev))}
      />
      {/* Not notifyChange: the version bump that follows is what reloads this list after an import. */}
      <EntryCsv
        filters={filters}
        onImported={() =>
          onChange
            ? onChange()
            : void loadEntries().catch((cause: unknown) =>
                showError(cause, 'Could not load the entries'),
              )
        }
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
