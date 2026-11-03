import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { formatDecimal, formatUsd, formatWon } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

// #45 Held assets and debts. Won values are numbers, quantities and USD values decimal strings (#35 rules).
// Trades come with #46, prices and FX conversion with #47.

type AssetType = 'stock' | 'real_estate' | 'cash' | 'debt' | 'depreciable' | 'other';
type Currency = 'KRW' | 'USD';
type Asset = {
  id: number;
  name: string;
  type: AssetType;
  currency: Currency;
  quantity: string | null;
  valueKrw: number | null;
  valueForeign: string | null;
  memo: string;
};
// A total is null when it is too large to show exactly.
type Totals = {
  assetsKrw: number | null;
  debtsKrw: number | null;
  netKrw: number | null;
  uncounted: number;
};
type Draft = {
  name: string;
  type: AssetType;
  currency: Currency;
  quantity: string;
  value: string;
  memo: string;
};
type Field = 'name' | 'quantity' | 'value';

const assetsPath = '/api/portfolio/assets';
const typeLabels: Record<AssetType, string> = {
  stock: '주식(ETF·펀드 포함)',
  real_estate: '부동산',
  cash: '현금(예적금 포함)',
  depreciable: '감가상각 대상',
  other: '기타(코인·선입금 등)',
  debt: '부채',
};
const typeOrder = Object.keys(typeLabels) as AssetType[];
const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';

const emptyDraft = (): Draft => ({
  name: '',
  type: 'cash',
  currency: 'KRW',
  quantity: '',
  value: '',
  memo: '',
});

// Commas are accepted only as thousands separators ("1,234.5"); anything else is left in so the check fails.
const digits = (text: string) => {
  const trimmed = text.trim();
  return /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(trimmed) ? trimmed.replaceAll(',', '') : trimmed;
};

const totalText = (value: number | null) =>
  value === null
    ? '너무 커서 표시할 수 없음'
    : value < 0
      ? `-${formatWon(-value)}`
      : formatWon(value);

/**
 * The request body for a draft, or the field and Korean message that is wrong. Mirrors the server rules
 * so the common mistakes are caught before sending; the server checks again.
 */
function toBody(draft: Draft): { body: object } | { field: Field; message: string } {
  const name = draft.name.trim();
  if (!name) return { field: 'name', message: '자산 이름을 입력하세요' };
  const quantityText = draft.type === 'debt' ? '' : digits(draft.quantity);
  if (
    quantityText &&
    (!/^\d{1,12}(\.\d{1,8})?$/.test(quantityText) || !/[1-9]/.test(quantityText))
  ) {
    return { field: 'quantity', message: '수량은 0보다 큰 수로, 소수 8자리까지 입력하세요' };
  }
  const valueText = digits(draft.value);
  let valueKrw: number | null = null;
  let valueForeign: string | null = null;
  if (valueText && draft.currency === 'KRW') {
    if (!/^\d{1,16}$/.test(valueText)) {
      return { field: 'value', message: '원화 평가금액은 0 이상의 원 단위 정수로 입력하세요' };
    }
    if (Number(valueText) > 1e15) {
      return { field: 'value', message: '평가금액은 1,000조 원 이하로 입력하세요' };
    }
    valueKrw = Number(valueText);
  }
  if (valueText && draft.currency === 'USD') {
    if (!/^\d{1,16}(\.\d{1,4})?$/.test(valueText)) {
      return { field: 'value', message: '달러 평가금액은 소수 4자리까지 입력하세요' };
    }
    valueForeign = valueText;
  }
  if (!quantityText && valueKrw === null && valueForeign === null) {
    return { field: 'value', message: '수량이 없는 자산은 평가금액을 입력하세요' };
  }
  return {
    body: {
      name,
      type: draft.type,
      currency: draft.currency,
      quantity: quantityText || null,
      valueKrw,
      valueForeign,
      memo: draft.memo,
    },
  };
}

function valueText(asset: Asset) {
  if (asset.valueKrw !== null) return formatWon(asset.valueKrw);
  if (asset.valueForeign !== null) return formatUsd(asset.valueForeign);
  return '평가금액 없음';
}

export function AssetManager() {
  const [assets, setAssets] = useState<Asset[] | undefined>(undefined);
  const [totals, setTotals] = useState<Totals | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Asset | undefined>(undefined);
  const [invalid, setInvalid] = useState<Field | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  // Where the delete dialog returns focus: empty (back to its trigger) unless the delete went through.
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  const load = useCallback(async () => {
    const data = await requestJson<{ assets: Asset[]; totals: Totals }>(assetsPath);
    setAssets(data.assets);
    setTotals(data.totals);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, '자산을 불러오지 못했습니다'));
  }, [load, showError]);

  // Opening an edit moves focus to the form above the list.
  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);

  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const clearInvalid = (field: Field) => {
    if (invalid === field) setInvalid(undefined);
  };
  const fieldProps = (field: Field) => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? 'assets-notice' : undefined,
  });

  const startEdit = (asset: Asset) => {
    if (saving.current) return;
    setInvalid(undefined);
    setEditing(asset);
    setDraft({
      name: asset.name,
      type: asset.type,
      currency: asset.currency,
      quantity: asset.quantity === null ? '' : formatDecimal(asset.quantity),
      value:
        asset.valueKrw !== null
          ? String(asset.valueKrw)
          : asset.valueForeign !== null
            ? formatDecimal(asset.valueForeign).replaceAll(',', '')
            : '',
      memo: asset.memo,
    });
    notice.clear();
  };

  const stopEdit = () => {
    setInvalid(undefined);
    setEditing(undefined);
    setDraft(emptyDraft());
  };

  const reload = async (done: string) => {
    try {
      await load();
      showStatus(done);
    } catch {
      showError(`${done}. 목록을 새로 불러오지 못했습니다`);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const result = toBody(draft);
    if ('field' in result) {
      setInvalid(result.field);
      showError(result.message);
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    try {
      try {
        await (editing
          ? requestJson(`${assetsPath}/${editing.id}`, { method: 'PUT', body: result.body })
          : requestJson(assetsPath, { method: 'POST', body: result.body }));
      } catch (cause) {
        showError(cause);
        return;
      }
      const done = editing
        ? `${draft.name.trim()}을(를) 수정했습니다`
        : `${draft.name.trim()}을(를) 추가했습니다`;
      if (editing) stopEdit();
      else setDraft(emptyDraft());
      await reload(done);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const remove = async (asset: Asset) => {
    if (saving.current) {
      showError('저장 중입니다. 잠시 후 다시 시도하세요');
      throw new Error('saving'); // keeps the dialog open
    }
    try {
      await requestJson(`${assetsPath}/${asset.id}`, { method: 'DELETE' });
    } catch (cause) {
      showError(cause);
      throw cause;
    }
    afterDelete.current = listTitle.current;
    if (editing?.id === asset.id) stopEdit();
    await reload(`${asset.name}을(를) 삭제했습니다`);
  };

  return (
    <div className="flex flex-col gap-6">
      <Notice id="assets-notice" notice={notice.notice} />
      {totals ? <Summary totals={totals} /> : null}
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2">{editing ? '자산 수정' : '새 자산'}</CardTitle>
          <CardDescription>
            수량만 넣은 자산과 달러 자산은 시세·환율 기능이 생기면 원화로 환산됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            aria-label={editing ? '자산 수정' : '새 자산'}
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 md:grid-cols-2"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-name">이름</Label>
              <Input
                id="asset-name"
                ref={nameInput}
                maxLength={50}
                placeholder="예: 비상금 통장"
                value={draft.name}
                {...fieldProps('name')}
                onChange={(event) => {
                  clearInvalid('name');
                  change({ name: event.target.value });
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-type">종류</Label>
              <select
                id="asset-type"
                className={selectClass}
                value={draft.type}
                onChange={(event) => change({ type: event.target.value as AssetType })}
              >
                {typeOrder.map((type) => (
                  <option key={type} value={type}>
                    {typeLabels[type]}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-body-sm font-medium">통화</legend>
              <div className="flex gap-4">
                {(['KRW', 'USD'] as const).map((currency) => (
                  <label key={currency} className="flex items-center gap-2 text-body-sm">
                    <input
                      type="radio"
                      name="asset-currency"
                      value={currency}
                      checked={draft.currency === currency}
                      onChange={() => change({ currency })}
                      className="size-4 accent-primary"
                    />
                    {currency === 'KRW' ? '원화(KRW)' : '달러(USD)'}
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.type === 'debt' ? null : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="asset-quantity">수량(선택)</Label>
                <Input
                  id="asset-quantity"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="예: 10 또는 0.5"
                  value={draft.quantity}
                  {...fieldProps('quantity')}
                  onChange={(event) => {
                    clearInvalid('quantity');
                    change({ quantity: event.target.value });
                  }}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-value">
                {draft.type === 'debt' ? '남은 금액' : '평가금액'}(
                {draft.currency === 'KRW' ? '원' : '달러'})
              </Label>
              <Input
                id="asset-value"
                inputMode={draft.currency === 'KRW' ? 'numeric' : 'decimal'}
                autoComplete="off"
                placeholder={draft.currency === 'KRW' ? '예: 5000000' : '예: 1234.56'}
                value={draft.value}
                {...fieldProps('value')}
                onChange={(event) => {
                  clearInvalid('value');
                  change({ value: event.target.value });
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-memo">메모</Label>
              <Input
                id="asset-memo"
                maxLength={200}
                value={draft.memo}
                onChange={(event) => change({ memo: event.target.value })}
              />
            </div>
            <div className="flex gap-2 md:col-span-2">
              {/* Stays enabled while saving so focus is kept; the ref ignores a second press. */}
              <Button type="submit" aria-busy={busy || undefined}>
                {busy ? '저장 중…' : editing ? '수정 저장' : '추가'}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (saving.current) return;
                    stopEdit();
                    // The cancel button goes away with the edit; keep focus in the form.
                    nameInput.current?.focus();
                  }}
                >
                  수정 취소
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <section aria-labelledby="assets-title" className="flex flex-col gap-4">
        <h2 id="assets-title" ref={listTitle} tabIndex={-1} className="outline-none">
          보유 자산과 부채
        </h2>
        <AssetList
          assets={assets}
          failed={notice.notice?.kind === 'error'}
          onEdit={startEdit}
          onDelete={remove}
          returnFocusRef={afterDelete}
          onDeleteOpen={() => {
            afterDelete.current = null;
          }}
        />
      </section>
    </div>
  );
}

function Summary({ totals }: { totals: Totals }) {
  const items = [
    { label: '자산 합계', value: totalText(totals.assetsKrw) },
    { label: '부채 합계', value: totalText(totals.debtsKrw) },
    {
      label: '순자산',
      value: totalText(totals.netKrw),
    },
  ];
  return (
    <section aria-label="합계" className="flex flex-col gap-2">
      <dl className="grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 rounded-xl border px-4 py-3">
            <dt className="text-body-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-muted-foreground">
        부채는 자산 합계에 더하지 않고 순자산에서만 뺍니다.
        {totals.uncounted > 0
          ? ` 원화 평가금액이 없는 ${totals.uncounted}개(수량만 넣은 자산, 달러 자산)는 합계에서 빠졌습니다.`
          : ''}
      </p>
    </section>
  );
}

function AssetList({
  assets,
  failed,
  onEdit,
  onDelete,
  returnFocusRef,
  onDeleteOpen,
}: {
  assets: Asset[] | undefined;
  failed: boolean;
  onEdit: (asset: Asset) => void;
  onDelete: (asset: Asset) => Promise<void>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onDeleteOpen: () => void;
}) {
  if (assets === undefined) {
    return failed ? null : (
      <p className="text-body-sm text-muted-foreground">자산을 불러오는 중입니다</p>
    );
  }
  if (assets.length === 0) {
    return <p className="text-body-sm text-muted-foreground">아직 등록한 자산이 없습니다.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {typeOrder
        .filter((type) => assets.some((asset) => asset.type === type))
        .map((type) => (
          <section key={type} aria-labelledby={`assets-${type}`} className="flex flex-col gap-2">
            <h3 id={`assets-${type}`} className="text-body font-semibold">
              {typeLabels[type]}
            </h3>
            <ul
              aria-labelledby={`assets-${type}`}
              className="flex flex-col divide-y rounded-xl border"
            >
              {assets
                .filter((asset) => asset.type === type)
                .map((asset) => (
                  <li
                    key={asset.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium break-words">{asset.name}</span>
                      <span className="text-body-sm text-muted-foreground">
                        {asset.currency}
                        {asset.quantity === null ? '' : ` · 수량 ${formatDecimal(asset.quantity)}`}
                        {asset.memo ? ` · ${asset.memo}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{valueText(asset)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${asset.name} 수정`}
                        onClick={() => onEdit(asset)}
                      >
                        수정
                      </Button>
                      <ConfirmDialog
                        title="자산을 삭제할까요?"
                        description={`${asset.name}. 삭제하면 되돌릴 수 없습니다.`}
                        onConfirm={() => onDelete(asset)}
                        returnFocusRef={returnFocusRef}
                        onOpenChange={(open) => {
                          if (open) onDeleteOpen();
                        }}
                        trigger={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`${asset.name} 삭제`}
                          >
                            삭제
                          </Button>
                        }
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
