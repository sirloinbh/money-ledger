import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { SkeletonList } from './components/ui/skeleton';
import { toast } from './components/ui/sonner';
import { Spinner } from './components/ui/spinner';
import type { Health } from './health';
import { requestJson } from './lib/api';
import { errorText, useNotice } from './lib/use-notice';
import { Page } from './page';

type Kind = 'expense' | 'income';
type Category = { id: number; kind: Kind; name: string; hidden: boolean };
type Save = (id: number, change: { name?: string; hidden?: boolean }) => Promise<boolean>;

const groups: { kind: Kind; label: string }[] = [
  { kind: 'expense', label: '지출' },
  { kind: 'income', label: '수입' },
];

// Waiting buttons use aria-disabled, not disabled: a disabled button drops keyboard focus.
// The shared button styles only `disabled`, so the waiting look is added here.
const waitingStyle = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** Runs one request at a time for a button and tells whether it is still waiting. */
function useWaiting<T extends string>() {
  const [waiting, setWaiting] = useState<T | null>(null);
  const track = async (what: T, request: Promise<boolean>) => {
    setWaiting(what);
    try {
      return await request;
    } finally {
      setWaiting(null);
    }
  };
  return [waiting, track] as const;
}

function CategoryRow({
  category,
  busy,
  onSave,
}: {
  category: Category;
  busy: boolean;
  onSave: Save;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [waiting, track] = useWaiting<'save' | 'hide'>();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Keyboard users stay in place: into the field when editing starts, back to the button when it ends.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  const close = () => {
    returnFocus.current = true;
    setEditing(false);
  };
  // A rename on its way cannot be called back, so cancelling waits for the answer.
  const cancel = () => {
    if (waiting === null) close();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await track('save', onSave(category.id, { name: draft }))) close();
  };

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
          <Label htmlFor={inputId}>{category.name} 새 이름</Label>
          <Input
            id={inputId}
            ref={inputRef}
            value={draft}
            maxLength={30}
            required
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancel();
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" aria-disabled={busy} className={waitingStyle}>
              {waiting === 'save' ? <Spinner size="sm" label="저장하는 중" /> : null}
              저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-disabled={waiting !== null}
              className={waitingStyle}
              onClick={cancel}
            >
              취소
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span
        className={`min-w-0 flex-1 text-body-sm break-words ${category.hidden ? 'text-muted-foreground' : ''}`}
      >
        {category.name}
      </span>
      {category.hidden ? <Badge variant="secondary">숨김</Badge> : null}
      <div className="flex gap-1">
        <Button
          ref={editRef}
          size="sm"
          variant="ghost"
          aria-label={`${category.name} 이름 수정`}
          onClick={() => {
            setDraft(category.name);
            setEditing(true);
          }}
        >
          수정
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-disabled={busy}
          className={waitingStyle}
          aria-label={`${category.name} ${category.hidden ? '다시 표시' : '숨기기'}`}
          onClick={() => void track('hide', onSave(category.id, { hidden: !category.hidden }))}
        >
          {waiting === 'hide' ? <Spinner size="sm" label="저장하는 중" /> : null}
          {category.hidden ? '다시 표시' : '숨기기'}
        </Button>
      </div>
    </li>
  );
}

function CategoryGroup({
  label,
  categories,
  busy,
  onAdd,
  onSave,
}: {
  label: string;
  categories: Category[];
  busy: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onSave: Save;
}) {
  const [name, setName] = useState('');
  const [waiting, track] = useWaiting<'add'>();
  const inputId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await track('add', onAdd(name))) setName('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {categories.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">아직 카테고리가 없습니다.</p>
        ) : (
          <ul className="divide-y">
            {categories.map((category) => (
              <CategoryRow key={category.id} category={category} busy={busy} onSave={onSave} />
            ))}
          </ul>
        )}
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
          <Label htmlFor={inputId}>새 {label} 카테고리</Label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={name}
              maxLength={30}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              type="submit"
              aria-disabled={busy}
              className={waitingStyle}
              aria-label={`${label} 카테고리 추가`}
            >
              {waiting === 'add' ? <Spinner size="sm" label="저장하는 중" /> : null}
              추가
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function CategoriesPage({ health, ledgerPath }: { health: Health; ledgerPath: string }) {
  const [categories, setCategories] = useState<Category[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const focusList = useRef(false);
  const { notice, error, clear } = useNotice();

  const load = useCallback(async () => {
    try {
      const data = await requestJson<{ categories: Category[] }>(
        '/api/categories?includeHidden=true',
      );
      setCategories(data.categories);
      clear();
      return true;
    } catch (cause) {
      error(cause);
      return false;
    } finally {
      setLoading(false);
    }
  }, [clear, error]);

  useEffect(() => {
    void load();
  }, [load]);

  // The retry button disappears once the list arrives, so focus moves to the list instead of the page start.
  useEffect(() => {
    if (categories && focusList.current) {
      focusList.current = false;
      listRef.current?.focus();
    }
  }, [categories]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    focusList.current = true;
    if (!(await load())) focusList.current = false;
    setRetrying(false);
  };

  // One write at a time. Results are toasts: the forms sit far down a long list, where a message at
  // the top would be off screen.
  const run = async (request: () => Promise<string>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      toast.success(await request());
      return true;
    } catch (cause) {
      toast.error(errorText(cause));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const add = (kind: Kind) => (name: string) =>
    run(async () => {
      const { category } = await requestJson<{ category: Category }>('/api/categories', {
        method: 'POST',
        body: { kind, name },
      });
      setCategories((current) => [...(current ?? []), category]);
      return `카테고리를 추가했습니다: ${category.name}`;
    });

  const save: Save = (id, change) =>
    run(async () => {
      const { category } = await requestJson<{ category: Category }>(`/api/categories/${id}`, {
        method: 'PATCH',
        body: change,
      });
      setCategories((current) =>
        current?.map((item) => (item.id === category.id ? category : item)),
      );
      if (change.hidden === undefined) return `이름을 바꿨습니다: ${category.name}`;
      return change.hidden
        ? `카테고리를 숨겼습니다: ${category.name}`
        : `카테고리를 다시 표시합니다: ${category.name}`;
    });

  return (
    <Page
      title="카테고리"
      description="수입과 지출을 나눌 카테고리를 관리합니다. 숨긴 카테고리는 새 내역을 입력할 때 나오지 않습니다."
      health={health}
    >
      <div className="flex flex-col gap-4">
        <div>
          <Button asChild variant="outline" size="sm">
            <Link to={ledgerPath}>가계부로 돌아가기</Link>
          </Button>
        </div>
        <Notice notice={notice} />
        {loading ? (
          <div aria-busy="true" aria-label="카테고리 불러오는 중">
            <SkeletonList />
          </div>
        ) : categories ? (
          <div
            ref={listRef}
            tabIndex={-1}
            aria-label="카테고리 목록"
            className="grid items-start gap-6 outline-none md:grid-cols-2"
          >
            {groups.map(({ kind, label }) => (
              <CategoryGroup
                key={kind}
                label={label}
                categories={categories.filter((category) => category.kind === kind)}
                busy={busy}
                onAdd={add(kind)}
                onSave={save}
              />
            ))}
          </div>
        ) : (
          <div>
            <Button
              variant="outline"
              aria-disabled={retrying}
              className={waitingStyle}
              onClick={() => void retry()}
            >
              {retrying ? <Spinner size="sm" label="불러오는 중" /> : null}
              다시 불러오기
            </Button>
          </div>
        )}
      </div>
    </Page>
  );
}
