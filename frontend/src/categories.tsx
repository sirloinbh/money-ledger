import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

// #37 Income and expense categories. A category is hidden, never deleted, so entries keep it.

type CategoryKind = 'income' | 'expense';
type Category = { id: number; kind: CategoryKind; name: string; hidden: boolean };

const categoriesPath = '/api/ledger/categories';
const kinds: { kind: CategoryKind; title: string }[] = [
  { kind: 'expense', title: 'Expense category' },
  { kind: 'income', title: 'Income category' },
];

// Runs one change, then reloads the list. Resolves true when the change itself succeeded.
type Save = (run: () => Promise<unknown>, done: string) => Promise<boolean>;

/** `onChange` runs after each saved change, so other parts of the page can reload categories. */
export function CategoryManager({ onChange }: { onChange?: () => void } = {}) {
  const [categories, setCategories] = useState<Category[] | undefined>(undefined);
  // One change at a time: a second click or Enter while saving would only add a confusing error.
  // Buttons stay enabled so keyboard focus never drops to the page; the ref ignores the extra press.
  const saving = useRef(false);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  const load = useCallback(async () => {
    const data = await requestJson<{ categories: Category[] }>(categoriesPath);
    setCategories(data.categories);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, 'Could not load the categories'));
  }, [load, showError]);

  const save: Save = async (run, done) => {
    if (saving.current) return false;
    saving.current = true;
    try {
      try {
        await run();
        onChange?.();
      } catch (cause) {
        showError(cause);
        return false;
      }
      // The change is saved even when the reload fails; say both instead of reporting a failure.
      try {
        await load();
        showStatus(done);
      } catch {
        showError(`${done}. Could not reload the list`);
      }
      return true;
    } finally {
      saving.current = false;
    }
  };

  return (
    <section aria-labelledby="categories-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="categories-title">Categories</h2>
        <p className="text-body-sm text-muted-foreground">
          Hiding a category you no longer use removes it from the new-entry list. Past entries stay
          as they are.
        </p>
      </div>
      <Notice notice={notice.notice} />
      {categories === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">Loading categories</p>
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {kinds.map(({ kind, title }) => (
            <KindCard
              key={kind}
              kind={kind}
              title={title}
              categories={categories.filter((category) => category.kind === kind)}
              save={save}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KindCard({
  kind,
  title,
  categories,
  save,
}: {
  kind: CategoryKind;
  title: string;
  categories: Category[];
  save: Save;
}) {
  const [name, setName] = useState('');
  const inputId = `new-${kind}-category`;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const added = await save(
      () => requestJson(categoriesPath, { method: 'POST', body: { kind, name: trimmed } }),
      `${trimmed} category added`,
    );
    if (added) setName('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h3">{title}</CardTitle>
        <CardDescription>
          {categories.filter((category) => !category.hidden).length} in use
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-2">
          <Label htmlFor={inputId}>New {title.toLowerCase()}</Label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={name}
              maxLength={30}
              placeholder="e.g. Pets"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={!name.trim()}>
              Add
            </Button>
          </div>
        </form>
        <ul aria-label={title} className="flex flex-col divide-y">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} save={save} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CategoryRow({ category, save }: { category: Category; save: Save }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const nameInput = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Focus follows the rename: into the name field when it opens, back to its button when it closes.
  useEffect(() => {
    if (editing) nameInput.current?.focus();
    else if (wasEditing.current) renameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const path = `${categoriesPath}/${category.id}`;

  const startRename = () => {
    // Start from the saved name, which may have changed since this row first rendered.
    setName(category.name);
    setEditing(true);
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const renamed = await save(
      () => requestJson(path, { method: 'PATCH', body: { name: trimmed } }),
      `Category renamed to ${trimmed}`,
    );
    if (renamed) setEditing(false);
  };

  const toggleHidden = () =>
    save(
      () => requestJson(path, { method: 'PATCH', body: { hidden: !category.hidden } }),
      category.hidden
        ? `${category.name} category is visible again`
        : `${category.name} category hidden`,
    );

  if (editing) {
    const inputId = `category-${category.id}-name`;
    return (
      <li className="py-2">
        <form onSubmit={(event) => void rename(event)} className="flex flex-col gap-2">
          <Label htmlFor={inputId} className="sr-only">
            {category.name} new name
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={inputId}
              value={name}
              maxLength={30}
              ref={nameInput}
              className="min-w-0 flex-1"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span
        className={
          category.hidden
            ? 'flex items-center gap-2 text-muted-foreground'
            : 'flex items-center gap-2'
        }
      >
        {category.name}
        {category.hidden ? <Badge variant="outline">Hidden</Badge> : null}
      </span>
      <span className="flex gap-1">
        <Button
          ref={renameButton}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Rename ${category.name}`}
          onClick={startRename}
        >
          Rename
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={category.hidden ? `Show ${category.name} again` : `Hide ${category.name}`}
          onClick={() => void toggleHidden()}
        >
          {category.hidden ? 'Show again' : 'Hide'}
        </Button>
      </span>
    </li>
  );
}
