import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatWon } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

// #60 Uncategorized entries, bulk classification and keyword rules. Rules match the merchant only and fill
// entries saved without a category; a category the user chose is never replaced (2026-11-05 decisions).

type Kind = 'income' | 'expense';
type Category = { id: number; kind: Kind; name: string; hidden: boolean };
type Entry = {
  id: number;
  date: string;
  kind: Kind;
  amount: number;
  merchant: string;
  memo: string;
};
type Rule = {
  id: number;
  keyword: string;
  kind: Kind;
  categoryName: string;
  categoryHidden: boolean;
};

const kindLabel: Record<Kind, string> = { expense: '지출', income: '수입' };
const kinds = ['expense', 'income'] as const;
const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';
const checkboxClass = 'size-4 accent-primary';

/** Visible categories grouped by kind, for a <select>. */
function CategoryOptions({ categories }: { categories: Category[] }) {
  return kinds.map((kind) => (
    <optgroup key={kind} label={kindLabel[kind]}>
      {categories
        .filter((category) => category.kind === kind && !category.hidden)
        .map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
    </optgroup>
  ));
}

function useCategories(version: number, onError: (cause: unknown, fallback?: string) => void) {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    requestJson<{ categories: Category[] }>('/api/ledger/categories?visible=true')
      .then((data) => setCategories(data.categories))
      .catch((cause: unknown) => onError(cause, '카테고리를 불러오지 못했습니다'));
  }, [version, onError]);
  return categories;
}

/**
 * Reports a change made here. The component reloads by itself for its status message, so the version bump
 * that comes back skips one reload (`skipReload`) instead of loading the same list twice.
 */
function useOwnChange(onChange: (() => void) | undefined) {
  const skipReload = useRef(false);
  const notifyChange = () => {
    if (!onChange) return;
    skipReload.current = true;
    onChange();
  };
  return { skipReload, notifyChange };
}

/**
 * Entries without a category: pick some, pick a category, classify them at once. `version` changes when
 * entries or rules change elsewhere on the page; `onChange` reports a classification here.
 */
export function UncategorizedEntries({
  categoriesVersion = 0,
  version = 0,
  onChange,
}: {
  categoriesVersion?: number;
  version?: number;
  onChange?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[] | undefined>(undefined);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [categoryId, setCategoryId] = useState('');
  const [remember, setRemember] = useState(true);
  const [categoryInvalid, setCategoryInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  const categories = useCategories(categoriesVersion, showError);

  const load = useCallback(async () => {
    const data = await requestJson<{ entries: Entry[] }>('/api/ledger/entries?uncategorized=true');
    setEntries(data.entries);
    // Entries classified elsewhere drop out of the selection.
    setSelected(
      (current) => new Set(data.entries.filter((e) => current.has(e.id)).map((e) => e.id)),
    );
    return data.entries;
  }, []);

  const { skipReload, notifyChange } = useOwnChange(onChange);
  useEffect(() => {
    if (skipReload.current) {
      skipReload.current = false;
      return;
    }
    load().catch((cause: unknown) => showError(cause, '미분류 내역을 불러오지 못했습니다'));
  }, [load, showError, version, skipReload]);

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // After a reload that empties the list the controls go away; focus moves to the section heading.
  const reloadAfter = async (done: string) => {
    try {
      const left = await load();
      showStatus(done);
      if (left.length === 0) title.current?.focus();
    } catch {
      showError(`${done}. 목록을 새로 불러오지 못했습니다`);
    }
  };

  const classify = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current || !entries) return;
    const picked = entries.filter((entry) => selected.has(entry.id));
    const category = categories.find((item) => String(item.id) === categoryId);
    if (picked.length === 0) return showError('분류할 내역을 고르세요');
    if (!category || picked.some((entry) => entry.kind !== category.kind)) {
      setCategoryInvalid(true);
      return showError(
        category ? '고른 카테고리와 종류가 다른 내역이 있습니다' : '카테고리를 고르세요',
      );
    }
    setCategoryInvalid(false);
    saving.current = true;
    setBusy(true);
    try {
      let result: {
        classified: number;
        skipped: number;
        rulesAdded: number;
        rulesUpdated: number;
      };
      try {
        result = await requestJson('/api/ledger/entries/classify', {
          method: 'POST',
          body: { entryIds: picked.map((entry) => entry.id), categoryId: category.id, remember },
        });
      } catch (cause) {
        showError(cause);
        return;
      }
      notifyChange();
      const parts = [`${result.classified}건을 ${category.name}(으)로 분류했습니다`];
      if (result.skipped > 0) {
        parts.push(`${result.skipped}건은 이미 분류되었거나 바뀌어 건너뛰었습니다`);
      }
      if (result.rulesAdded > 0)
        parts.push(`가맹점 ${result.rulesAdded}개를 규칙으로 저장했습니다`);
      if (result.rulesUpdated > 0) {
        parts.push(`기존 규칙 ${result.rulesUpdated}개를 ${category.name}(으)로 바꿨습니다`);
      }
      setSelected(new Set());
      await reloadAfter(parts.join('. '));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const applyRules = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      let result: { classified: number };
      try {
        result = await requestJson('/api/ledger/entries/apply-rules', { method: 'POST' });
      } catch (cause) {
        showError(cause);
        return;
      }
      if (result.classified > 0) notifyChange();
      await reloadAfter(
        result.classified > 0
          ? `${result.classified}건을 규칙으로 분류했습니다`
          : '규칙에 맞는 미분류 내역이 없습니다',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const allSelected = !!entries && entries.length > 0 && selected.size === entries.length;

  return (
    <section aria-labelledby="uncategorized-title" className="flex flex-col gap-4">
      <h2 id="uncategorized-title" ref={title} tabIndex={-1} className="outline-none">
        미분류 내역{entries && entries.length > 0 ? ` (${entries.length}건)` : ''}
      </h2>
      <Notice id="uncategorized-notice" notice={notice.notice} />
      {entries === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">미분류 내역을 불러오는 중입니다</p>
        )
      ) : entries.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">미분류 내역이 없습니다.</p>
      ) : (
        <form
          aria-label="미분류 내역 분류"
          onSubmit={(event) => void classify(event)}
          className="flex flex-col gap-4"
        >
          <label className="flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))
              }
            />
            전체 선택
          </label>
          <ul aria-label="미분류 내역" className="flex flex-col divide-y rounded-xl border">
            {entries.map((entry) => (
              <li key={entry.id}>
                <label className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={selected.has(entry.id)}
                    onChange={() => toggle(entry.id)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
                      {entry.date}
                      <Badge variant={entry.kind === 'income' ? 'success' : 'secondary'}>
                        {kindLabel[entry.kind]}
                      </Badge>
                    </span>
                    <span className="break-words">
                      {[entry.merchant || '가맹점 없음', entry.memo].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{formatWon(entry.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <div className="flex flex-col gap-2">
              <Label htmlFor="classify-category">분류할 카테고리</Label>
              <select
                id="classify-category"
                className={selectClass}
                value={categoryId}
                aria-invalid={categoryInvalid || undefined}
                aria-describedby={categoryInvalid ? 'uncategorized-notice' : undefined}
                onChange={(event) => {
                  setCategoryInvalid(false);
                  setCategoryId(event.target.value);
                }}
              >
                <option value="">고르세요</option>
                <CategoryOptions categories={categories} />
              </select>
            </div>
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              다음에도 같은 가맹점은 이 카테고리로 분류(규칙으로 저장)
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? '처리 중…' : `선택한 ${selected.size}건 분류`}
            </Button>
            <Button type="button" variant="outline" onClick={() => void applyRules()}>
              규칙으로 다시 분류
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Keyword rules: add and delete. `version` changes when rules may have been saved elsewhere. */
export function RuleManager({
  categoriesVersion = 0,
  version = 0,
  onChange,
}: {
  categoriesVersion?: number;
  version?: number;
  onChange?: () => void;
}) {
  const [rules, setRules] = useState<Rule[] | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [invalid, setInvalid] = useState<'keyword' | 'category' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  // Where the delete dialog returns focus: empty (back to its trigger) unless the delete went through.
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;
  const categories = useCategories(categoriesVersion, showError);

  const load = useCallback(async () => {
    const data = await requestJson<{ rules: Rule[] }>('/api/ledger/rules');
    setRules(data.rules);
  }, []);

  const { skipReload, notifyChange } = useOwnChange(onChange);
  useEffect(() => {
    if (skipReload.current) {
      skipReload.current = false;
      return;
    }
    load().catch((cause: unknown) => showError(cause, '분류 규칙을 불러오지 못했습니다'));
  }, [load, showError, version, skipReload]);

  const reload = async (done: string) => {
    try {
      await load();
      showStatus(done);
    } catch {
      showError(`${done}. 목록을 새로 불러오지 못했습니다`);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const text = keyword.trim();
    if (!text) {
      setInvalid('keyword');
      return showError('키워드를 입력하세요');
    }
    if (!categoryId) {
      setInvalid('category');
      return showError('카테고리를 고르세요');
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    try {
      try {
        await requestJson('/api/ledger/rules', {
          method: 'POST',
          body: { keyword: text, categoryId: Number(categoryId) },
        });
      } catch (cause) {
        showError(cause);
        return;
      }
      notifyChange();
      setKeyword('');
      await reload(`'${text}' 규칙을 추가했습니다`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const remove = async (rule: Rule) => {
    try {
      await requestJson(`/api/ledger/rules/${rule.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      throw cause; // keeps the dialog open
    }
    notifyChange();
    afterDelete.current = title.current;
    await reload(`'${rule.keyword}' 규칙을 삭제했습니다`);
  };

  const fieldProps = (field: 'keyword' | 'category') => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? 'rules-notice' : undefined,
  });

  return (
    <section aria-labelledby="rules-title" className="flex flex-col gap-4">
      {/* Focus lands here after a delete: the deleted row held the dialog trigger. */}
      <h2 id="rules-title" ref={title} tabIndex={-1} className="outline-none">
        분류 규칙
      </h2>
      <Notice id="rules-notice" notice={notice.notice} />
      <Card>
        <CardHeader>
          <CardTitle asHeading="h3">새 규칙</CardTitle>
          <CardDescription>
            가맹점 이름에 키워드가 들어 있으면(대소문자 무시) 그 카테고리로 분류합니다. 여러 규칙이
            맞으면 더 긴 키워드를 씁니다. 직접 고른 카테고리는 바꾸지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            aria-label="새 규칙"
            onSubmit={(event) => void add(event)}
            className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-keyword">키워드</Label>
              <Input
                id="rule-keyword"
                maxLength={50}
                autoComplete="off"
                placeholder="예: 스타벅스"
                value={keyword}
                {...fieldProps('keyword')}
                onChange={(event) => {
                  if (invalid === 'keyword') setInvalid(undefined);
                  setKeyword(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-category">카테고리</Label>
              <select
                id="rule-category"
                className={selectClass}
                value={categoryId}
                {...fieldProps('category')}
                onChange={(event) => {
                  if (invalid === 'category') setInvalid(undefined);
                  setCategoryId(event.target.value);
                }}
              >
                <option value="">고르세요</option>
                <CategoryOptions categories={categories} />
              </select>
            </div>
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? '저장 중…' : '규칙 추가'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {rules === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">분류 규칙을 불러오는 중입니다</p>
        )
      ) : rules.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">아직 분류 규칙이 없습니다.</p>
      ) : (
        <ul aria-label="분류 규칙 목록" className="flex flex-col divide-y rounded-xl border">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium break-words">{rule.keyword}</span>
                <span aria-hidden="true">→</span>
                <Badge variant={rule.kind === 'income' ? 'success' : 'secondary'}>
                  {kindLabel[rule.kind]}
                </Badge>
                {rule.categoryName}
                {rule.categoryHidden ? (
                  <span className="text-caption text-muted-foreground">
                    (숨긴 카테고리라 적용하지 않음)
                  </span>
                ) : null}
              </span>
              <ConfirmDialog
                title="규칙을 삭제할까요?"
                description={`'${rule.keyword}' → ${rule.categoryName}. 이미 분류한 내역은 그대로 둡니다.`}
                onConfirm={() => remove(rule)}
                returnFocusRef={afterDelete}
                onOpenChange={(open) => {
                  if (open) afterDelete.current = null;
                }}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${rule.keyword} 규칙 삭제`}
                  >
                    삭제
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
