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
  { kind: 'expense', title: '지출 카테고리' },
  { kind: 'income', title: '수입 카테고리' },
];

// Runs one change, then reloads the list. Resolves true when the change itself succeeded.
type Save = (run: () => Promise<unknown>, done: string) => Promise<boolean>;

export function CategoryManager() {
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
    load().catch((cause: unknown) => showError(cause, '카테고리를 불러오지 못했습니다'));
  }, [load, showError]);

  const save: Save = async (run, done) => {
    if (saving.current) return false;
    saving.current = true;
    try {
      try {
        await run();
      } catch (cause) {
        showError(cause);
        return false;
      }
      // The change is saved even when the reload fails; say both instead of reporting a failure.
      try {
        await load();
        showStatus(done);
      } catch {
        showError(`${done}. 목록을 새로 불러오지 못했습니다`);
      }
      return true;
    } finally {
      saving.current = false;
    }
  };

  return (
    <section aria-labelledby="categories-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="categories-title">카테고리</h2>
        <p className="text-body-sm text-muted-foreground">
          쓰지 않는 카테고리는 숨기면 새 내역 입력 목록에서 빠집니다. 지난 내역은 그대로 남습니다.
        </p>
      </div>
      <Notice notice={notice.notice} />
      {categories === undefined ? (
        notice.notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">카테고리를 불러오는 중입니다</p>
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
      `${trimmed} 카테고리를 추가했습니다`,
    );
    if (added) setName('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h3">{title}</CardTitle>
        <CardDescription>
          {categories.filter((category) => !category.hidden).length}개 사용 중
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-2">
          <Label htmlFor={inputId}>새 {title}</Label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={name}
              maxLength={30}
              placeholder="예: 반려동물"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={!name.trim()}>
              추가
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
      `카테고리 이름을 ${trimmed}(으)로 바꿨습니다`,
    );
    if (renamed) setEditing(false);
  };

  const toggleHidden = () =>
    save(
      () => requestJson(path, { method: 'PATCH', body: { hidden: !category.hidden } }),
      category.hidden
        ? `${category.name} 카테고리를 다시 보이게 했습니다`
        : `${category.name} 카테고리를 숨겼습니다`,
    );

  if (editing) {
    const inputId = `category-${category.id}-name`;
    return (
      <li className="py-2">
        <form onSubmit={(event) => void rename(event)} className="flex flex-col gap-2">
          <Label htmlFor={inputId} className="sr-only">
            {category.name} 새 이름
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
              저장
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              취소
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
        {category.hidden ? <Badge variant="outline">숨김</Badge> : null}
      </span>
      <span className="flex gap-1">
        <Button
          ref={renameButton}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${category.name} 이름 바꾸기`}
          onClick={startRename}
        >
          이름 바꾸기
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={category.hidden ? `${category.name} 다시 보이기` : `${category.name} 숨기기`}
          onClick={() => void toggleHidden()}
        >
          {category.hidden ? '다시 보이기' : '숨기기'}
        </Button>
      </span>
    </li>
  );
}
