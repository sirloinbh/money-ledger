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

const kindLabel: Record<Kind, string> = { expense: 'Expense', income: 'Income' };
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
      .catch((cause: unknown) => onError(cause, 'Could not load the categories'));
  }, [version, onError]);
  return categories;
}

/**
 * Reports a change made here. The component reloads by itself for its status message, so the version bump
 * that comes back skips one reload (`skipReload`) instead of loading the same list twice. Contract: the
 * parent passes the version it bumps back to this component (LedgerPage does), which clears the flag.
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
    load().catch((cause: unknown) => showError(cause, 'Could not load the uncategorized entries'));
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
      showError(`${done}. Could not reload the list`);
    }
  };

  const classify = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current || !entries) return;
    const picked = entries.filter((entry) => selected.has(entry.id));
    const category = categories.find((item) => String(item.id) === categoryId);
    if (picked.length === 0) return showError('Select the entries to classify');
    if (!category || picked.some((entry) => entry.kind !== category.kind)) {
      setCategoryInvalid(true);
      return showError(
        category
          ? 'Some entries are a different kind from the chosen category'
          : 'Choose a category',
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
      const parts = [
        `${result.classified} ${result.classified === 1 ? 'entry' : 'entries'} classified as ${category.name}`,
      ];
      if (result.skipped > 0) {
        parts.push(`${result.skipped} skipped (already classified or changed)`);
      }
      if (result.rulesAdded > 0)
        parts.push(
          `Saved ${result.rulesAdded} merchant ${result.rulesAdded === 1 ? 'rule' : 'rules'}`,
        );
      if (result.rulesUpdated > 0) {
        parts.push(
          `${result.rulesUpdated} existing ${result.rulesUpdated === 1 ? 'rule' : 'rules'} changed to ${category.name}`,
        );
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
          ? `${result.classified} ${result.classified === 1 ? 'entry' : 'entries'} classified by rules`
          : 'No uncategorized entries match the rules',
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
        Uncategorized entries{entries && entries.length > 0 ? ` (${entries.length})` : ''}
      </h2>
      <Notice id="uncategorized-notice" notice={notice.notice} />
      {entries === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">Loading uncategorized entries</p>
        )
      ) : entries.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">There are no uncategorized entries.</p>
      ) : (
        <form
          aria-label="Classify uncategorized entries"
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
            Select all
          </label>
          <ul
            aria-label="Uncategorized entries"
            className="flex flex-col divide-y rounded-xl border"
          >
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
                      {[entry.merchant || 'No merchant', entry.memo].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{formatWon(entry.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <div className="flex flex-col gap-2">
              <Label htmlFor="classify-category">Category to apply</Label>
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
                <option value="">Choose</option>
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
              Classify the same merchant into this category next time (save as a rule)
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? 'Working…' : `Classify ${selected.size} selected`}
            </Button>
            <Button type="button" variant="outline" onClick={() => void applyRules()}>
              Reclassify with rules
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
    load().catch((cause: unknown) => showError(cause, 'Could not load the classification rules'));
    // categoriesVersion too: a rule shows its category's current name and hidden state.
  }, [load, showError, version, categoriesVersion, skipReload]);

  const reload = async (done: string) => {
    try {
      await load();
      showStatus(done);
    } catch {
      showError(`${done}. Could not reload the list`);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const text = keyword.trim();
    if (!text) {
      setInvalid('keyword');
      return showError('Enter a keyword');
    }
    if (!categoryId) {
      setInvalid('category');
      return showError('Choose a category');
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
      await reload(`Rule '${text}' added`);
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
    await reload(`Rule '${rule.keyword}' deleted`);
  };

  const fieldProps = (field: 'keyword' | 'category') => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? 'rules-notice' : undefined,
  });

  return (
    <section aria-labelledby="rules-title" className="flex flex-col gap-4">
      {/* Focus lands here after a delete: the deleted row held the dialog trigger. */}
      <h2 id="rules-title" ref={title} tabIndex={-1} className="outline-none">
        Classification rules
      </h2>
      <Notice id="rules-notice" notice={notice.notice} />
      <Card>
        <CardHeader>
          <CardTitle asHeading="h3">New rule</CardTitle>
          <CardDescription>
            If a merchant name contains the keyword (case-insensitive), the entry is put in that
            category. When several rules match, the longer keyword wins. A category you chose by
            hand is not changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            aria-label="New rule"
            onSubmit={(event) => void add(event)}
            className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-keyword">Keyword</Label>
              <Input
                id="rule-keyword"
                maxLength={50}
                autoComplete="off"
                placeholder="e.g. Starbucks"
                value={keyword}
                {...fieldProps('keyword')}
                onChange={(event) => {
                  if (invalid === 'keyword') setInvalid(undefined);
                  setKeyword(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-category">Category</Label>
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
                <option value="">Choose</option>
                <CategoryOptions categories={categories} />
              </select>
            </div>
            <Button type="submit" aria-busy={busy || undefined}>
              {busy ? 'Saving…' : 'Add rule'}
            </Button>
          </form>
        </CardContent>
      </Card>
      {rules === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">Loading classification rules</p>
        )
      ) : rules.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">There are no classification rules yet.</p>
      ) : (
        <ul aria-label="Classification rules" className="flex flex-col divide-y rounded-xl border">
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
                    (not applied because the category is hidden)
                  </span>
                ) : null}
              </span>
              <ConfirmDialog
                title="Delete this rule?"
                description={`'${rule.keyword}' → ${rule.categoryName}. Entries already classified stay as they are.`}
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
                    aria-label={`Delete rule ${rule.keyword}`}
                  >
                    Delete
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
