import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatWon, serviceToday } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

// #38 Income and expense entries: add, edit, delete. The list shows the latest 100; filters come with #39.

type Kind = 'income' | 'expense';
type Category = { id: number; kind: Kind; name: string; hidden: boolean };
type Entry = {
  id: number;
  date: string;
  kind: Kind;
  amount: number;
  categoryId: number;
  categoryName: string;
  memo: string;
};
type Draft = { date: string; kind: Kind; amount: string; categoryId: string; memo: string };

const entriesPath = '/api/ledger/entries';
const kindLabel: Record<Kind, string> = { expense: '지출', income: '수입' };
const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';

const emptyDraft = (): Draft => ({
  date: serviceToday(),
  kind: 'expense',
  amount: '',
  categoryId: '',
  memo: '',
});

/** "12,500" or "12500" → 12500; anything else (sign, decimals, letters) → undefined. */
function parseAmount(text: string) {
  const digits = text.replaceAll(',', '').trim();
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** `categoriesVersion` changes when categories are edited elsewhere on the page, so the choices reload. */
export function EntryManager({ categoriesVersion = 0 }: { categoriesVersion?: number }) {
  const [entries, setEntries] = useState<Entry[] | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Entry | undefined>(undefined);
  const saving = useRef(false);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  const loadEntries = useCallback(async () => {
    const data = await requestJson<{ entries: Entry[] }>(entriesPath);
    setEntries(data.entries);
  }, []);

  useEffect(() => {
    loadEntries().catch((cause: unknown) => showError(cause, '내역을 불러오지 못했습니다'));
  }, [loadEntries, showError]);

  useEffect(() => {
    requestJson<{ categories: Category[] }>('/api/ledger/categories')
      .then((data) => setCategories(data.categories))
      .catch((cause: unknown) => showError(cause, '카테고리를 불러오지 못했습니다'));
  }, [categoriesVersion, showError]);

  // Visible categories of the chosen kind, plus the hidden one an edited entry already has.
  const choices = categories.filter(
    (category) =>
      category.kind === draft.kind && (!category.hidden || category.id === editing?.categoryId),
  );

  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const startEdit = (entry: Entry) => {
    setEditing(entry);
    setDraft({
      date: entry.date,
      kind: entry.kind,
      amount: String(entry.amount),
      categoryId: String(entry.categoryId),
      memo: entry.memo,
    });
    notice.clear();
  };

  const stopEdit = () => {
    setEditing(undefined);
    setDraft(emptyDraft());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseAmount(draft.amount);
    if (amount === undefined) {
      showError('금액은 0원 이상의 정수로 입력하세요');
      return;
    }
    if (!draft.categoryId) {
      showError('카테고리를 고르세요');
      return;
    }
    if (saving.current) return;
    saving.current = true;
    const body = {
      date: draft.date,
      kind: draft.kind,
      amount,
      categoryId: Number(draft.categoryId),
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
      const done = editing
        ? '내역을 수정했습니다'
        : `${kindLabel[draft.kind]} ${formatWon(amount)}을 기록했습니다`;
      if (editing) {
        stopEdit();
      } else {
        // Keep the date and kind for the next entry of the same day.
        setDraft((current) => ({ ...current, amount: '', memo: '' }));
      }
      try {
        await loadEntries();
        showStatus(done);
      } catch {
        showError(`${done}. 목록을 새로 불러오지 못했습니다`);
      }
    } finally {
      saving.current = false;
    }
  };

  const remove = async (entry: Entry) => {
    try {
      await requestJson(`${entriesPath}/${entry.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      throw cause; // keeps the dialog open
    }
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
      <h2 id="entries-title">수입·지출 내역</h2>
      <Notice notice={notice.notice} />
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
                onChange={(event) => change({ amount: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-category">카테고리</Label>
              <select
                id="entry-category"
                className={selectClass}
                value={draft.categoryId}
                onChange={(event) => change({ categoryId: event.target.value })}
              >
                <option value="">고르세요</option>
                {choices.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.hidden ? `${category.name} (숨김)` : category.name}
                  </option>
                ))}
              </select>
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
              <Button type="submit">{editing ? '수정 저장' : '기록'}</Button>
              {editing ? (
                <Button type="button" variant="ghost" onClick={stopEdit}>
                  수정 취소
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <EntryList
        entries={entries}
        failed={notice.notice?.kind === 'error'}
        onEdit={startEdit}
        onDelete={remove}
      />
    </section>
  );
}

function EntryList({
  entries,
  failed,
  onEdit,
  onDelete,
}: {
  entries: Entry[] | undefined;
  failed: boolean;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => Promise<void>;
}) {
  if (entries === undefined) {
    return failed ? null : (
      <p className="text-body-sm text-muted-foreground">내역을 불러오는 중입니다</p>
    );
  }
  if (entries.length === 0) {
    return <p className="text-body-sm text-muted-foreground">아직 기록한 내역이 없습니다.</p>;
  }
  return (
    <ul aria-label="최근 내역" className="flex flex-col divide-y rounded-xl border">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
              {entry.date}
              <Badge variant={entry.kind === 'income' ? 'success' : 'secondary'}>
                {kindLabel[entry.kind]}
              </Badge>
              {entry.categoryName}
            </span>
            {entry.memo ? <span className="break-words">{entry.memo}</span> : null}
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
              aria-label={`${entry.date} ${entry.categoryName} ${formatWon(entry.amount)} 수정`}
              onClick={() => onEdit(entry)}
            >
              수정
            </Button>
            <ConfirmDialog
              title="내역을 삭제할까요?"
              description={`${entry.date} ${entry.categoryName} ${formatWon(entry.amount)}. 삭제하면 되돌릴 수 없습니다.`}
              onConfirm={() => onDelete(entry)}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${entry.date} ${entry.categoryName} ${formatWon(entry.amount)} 삭제`}
                >
                  삭제
                </Button>
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
