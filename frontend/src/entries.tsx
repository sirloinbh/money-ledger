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
  const search = searchParams.toString();
  // Memoized by the address: the filter form compares by identity to notice a change.
  const filters = useMemo(() => readFilters(new URLSearchParams(search), today), [search, today]);
  const query = apiQuery(filters, pageSize);
  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  // Only the latest request may fill the list: an older answer for other filters is dropped.
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  // The list shown is the one for the current filters; while another one loads, nothing stale is shown.
  const entries = listing?.query === query ? listing.entries : undefined;
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

  const loadEntries = useCallback(async () => {
    setLoadFailed(false);
    try {
      const data = await requestJson<{ entries: Entry[]; total: number }>(
        `${entriesPath}?${query}`,
      );
      if (latestQuery.current === query) setListing({ query, ...data });
    } catch (cause) {
      if (latestQuery.current === query) setLoadFailed(true);
      throw cause;
    }
  }, [query]);

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
    loadEntries().catch((cause: unknown) => showError(cause, '내역을 불러오지 못했습니다'));
  }, [loadEntries, showError, categoriesVersion, entriesVersion]);

  useEffect(() => {
    requestJson<{ categories: Category[] }>('/api/ledger/categories')
      .then((data) => {
        setCategories(data.categories);
        setCategoriesLoaded(true);
      })
      .catch((cause: unknown) => showError(cause, '카테고리를 불러오지 못했습니다'));
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
    showStatus('수정 중인 내역의 카테고리가 다른 곳에서 바뀌어 반영했습니다');
  }, [entries, editing, showStatus]);

  // Visible categories of the chosen kind, plus the hidden one an edited entry already has.
  const choices = categories.filter(
    (category) =>
      category.kind === draft.kind && (!category.hidden || category.id === editing?.categoryId),
  );

  // A chosen category that is no longer offered (hidden meanwhile) must be chosen again: saving it as
  // 미분류 without a word would drop the user's choice.
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
      showError('금액은 0원 이상의 정수로 입력하세요');
      return;
    }
    if (stale) {
      setInvalid('category');
      showError('고른 카테고리를 쓸 수 없습니다. 카테고리를 다시 고르세요');
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    const body = {
      date: draft.date,
      kind: draft.kind,
      amount,
      // Empty is 미분류: the server fills it from a matching keyword rule, if any.
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
        ? '내역을 수정했습니다'
        : `${kindLabel[draft.kind]} ${formatWon(amount)}을 기록했습니다`;
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
        showError(`${done}. 목록을 새로 불러오지 못했습니다`);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const remove = async (entry: Entry) => {
    if (saving.current) {
      showError('저장 중입니다. 잠시 후 다시 시도하세요');
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
      showStatus('내역을 삭제했습니다');
    } catch {
      showError('내역을 삭제했습니다. 목록을 새로 불러오지 못했습니다');
    }
  };

  return (
    <section aria-labelledby="entries-title" className="flex flex-col gap-4">
      {/* Focus lands here after a delete: the deleted row held the dialog trigger. */}
      <h2 id="entries-title" ref={sectionTitle} tabIndex={-1} className="outline-none">
        수입·지출 내역
      </h2>
      <Notice id="entries-notice" notice={notice.notice} />
      <Card>
        <CardHeader>
          <CardTitle asHeading="h3">{editing ? '내역 수정' : '새 내역'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            aria-label={editing ? '내역 수정' : '새 내역'}
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 md:grid-cols-2"
          >
            <fieldset className="flex flex-col gap-2 md:col-span-2">
              <legend className="mb-2 text-body-sm font-medium">종류</legend>
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
              <Label htmlFor="entry-date">날짜</Label>
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
              <Label htmlFor="entry-amount">금액(원)</Label>
              <Input
                id="entry-amount"
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 12500"
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
              <Label htmlFor="entry-category">카테고리</Label>
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
                    다시 고르세요
                  </option>
                ) : null}
                <option value="">미분류</option>
                {choices.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.hidden ? `${category.name} (숨김)` : category.name}
                  </option>
                ))}
              </select>
              <p id="entry-category-hint" className="text-caption text-muted-foreground">
                미분류로 두면 가맹점에 맞는 분류 규칙이 있을 때 자동으로 정해집니다.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-merchant">가맹점</Label>
              <Input
                id="entry-merchant"
                maxLength={50}
                autoComplete="off"
                placeholder="예: 스타벅스 강남점"
                value={draft.merchant}
                onChange={(event) => change({ merchant: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-memo">메모</Label>
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
                {busy ? '저장 중…' : editing ? '수정 저장' : '기록'}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (!saving.current) stopEdit();
                  }}
                >
                  수정 취소
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
        onApply={(next) => setSearchParams(writeFilters(next))}
      />
      <EntryList
        entries={entries}
        total={listing?.query === query ? listing.total : 0}
        failed={loadFailed}
        onRetry={() =>
          void loadEntries().catch((cause: unknown) =>
            showError(cause, '내역을 불러오지 못했습니다'),
          )
        }
        page={filters.page}
        onPage={(page) => setSearchParams(writeFilters({ ...filters, page }))}
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

/** "2026-11-05 식비 12,500원": names a row in button labels and the delete dialog. */
const entryLabel = (entry: Entry) =>
  `${entry.date} ${entry.categoryName ?? '미분류'} ${formatWon(entry.amount)}`;

function EntryList({
  entries,
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
  if (failed && entries === undefined) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body-sm text-muted-foreground">내역을 불러오지 못했습니다.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    );
  }
  if (entries === undefined) {
    return <p className="text-body-sm text-muted-foreground">내역을 불러오는 중입니다</p>;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pager =
    pages > 1 || page > 1 ? (
      <nav aria-label="내역 쪽" className="flex items-center justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(Math.min(page - 1, pages))}
        >
          이전 쪽
        </Button>
        <span className="text-body-sm tabular-nums">
          {page} / {pages}쪽
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          다음 쪽
        </Button>
      </nav>
    ) : null;
  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-muted-foreground">
          {total > 0 ? '이 쪽에는 내역이 없습니다.' : '조건에 맞는 내역이 없습니다.'}
        </p>
        {pager}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-muted-foreground">{total}건</p>
      <ul aria-label="내역 목록" className="flex flex-col divide-y rounded-xl border">
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
                {entry.categoryName ?? '미분류'}
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
                aria-label={`${entryLabel(entry)} 수정`}
                onClick={() => onEdit(entry)}
              >
                수정
              </Button>
              <ConfirmDialog
                title="내역을 삭제할까요?"
                description={`${entryLabel(entry)}. 삭제하면 되돌릴 수 없습니다.`}
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
                    aria-label={`${entryLabel(entry)} 삭제`}
                  >
                    삭제
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
