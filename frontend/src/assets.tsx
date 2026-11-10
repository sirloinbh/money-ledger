import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { type Allocation, AssetAllocation } from './asset-allocation';
import { AssetTrades } from './asset-trades';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import {
  formatDecimal,
  formatUsd,
  formatWon,
  realDate,
  serviceToday,
  withoutThousands as digits,
} from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { PrepaidUsages } from './prepaid-usages';
import { formatMonthDay, formatPrice, securityText } from './quote-format';
import { type LinkedSecurity, SecurityPicker } from './security-picker';

// #45 Held assets and debts. Won values are numbers, quantities and USD values decimal strings (#35 rules).
// Trades come with #46.
// #47 A stock can be linked to a security and is valued at the stored close; an unlinked stock or other asset
// can take a price entered by hand. USD values are converted with the newest stored USD rate, and assets with
// trades show their gain against the won cost (decisions 2026-11-10).
// #63 A depreciating asset is entered as a purchase price, date and useful life; the server returns its
// current value (straight-line by month, never below the salvage value).
// #64 A prepaid asset is a stored value (금액권, lowered by uses) or a pass (기간권, lowered by the day);
// the server returns its current value. Paying is a ledger expense, so a use is not recorded as one again.

type AssetType = 'stock' | 'real_estate' | 'cash' | 'debt' | 'depreciable' | 'prepaid' | 'other';
type Currency = 'KRW' | 'USD';
type PrepaidKind = 'amount' | 'period';
type Prepaid = {
  kind: PrepaidKind;
  amountKrw: number;
  startsOn: string | null;
  expiresOn: string | null;
  // Uses up to today (stored values only).
  usedKrw: number;
};
type Depreciation = {
  purchasePriceKrw: number;
  purchasedOn: string;
  usefulLifeMonths: number;
  salvageValueKrw: number;
};
type Asset = {
  id: number;
  name: string;
  type: AssetType;
  currency: Currency;
  quantity: string | null;
  valueKrw: number | null;
  valueForeign: string | null;
  memo: string;
  depreciation: Depreciation | null;
  prepaid: Prepaid | null;
  // #46 With trades the quantity is their total and cannot be entered here.
  hasTrades: boolean;
  // #47 The linked security (stocks) and the price entered by hand (unlinked stock or other).
  security: Omit<LinkedSecurity, 'currency'> | null;
  manualPrice: { price: string; pricedOn: string } | null;
  // The unit price the value uses and where it comes from.
  price: {
    price: string;
    currency: Currency;
    source: 'close' | 'manual';
    date: string;
    stale: boolean;
  } | null;
  // USD assets: the newest stored USD rate.
  fx: { fxRate: string; rateDate: string; stale: boolean } | null;
  // The won value counted in the totals today; null when it cannot be counted (valueIssue says why).
  currentValueKrw: number | null;
  // USD assets: the dollar value.
  currentValueForeign: string | null;
  valueIssue: 'no_price' | 'no_fx' | 'too_large' | null;
  // Assets with trades: won cost still held, the gain against it, and its rate in percent.
  costKrw: number | null;
  profitKrw: number | null;
  returnPercent: string | null;
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
  purchasePrice: string;
  purchasedOn: string;
  lifeMonths: string;
  salvage: string;
  prepaidKind: PrepaidKind;
  prepaidAmount: string;
  startsOn: string;
  expiresOn: string;
  security: LinkedSecurity | null;
  manualPrice: string;
  manualPricedOn: string;
};
type Field =
  | 'name'
  | 'quantity'
  | 'value'
  | 'purchasePrice'
  | 'purchasedOn'
  | 'lifeMonths'
  | 'salvage'
  | 'prepaidAmount'
  | 'startsOn'
  | 'expiresOn'
  | 'manualPrice'
  | 'manualPricedOn';

const minDate = '1900-01-01';
const maxDate = '2100-12-31';

// Decision (2026-11-02): default useful lives, editable after choosing.
const lifePresets = [
  { label: '침대(10년)', months: 120 },
  { label: '컴퓨터(5년)', months: 60 },
  { label: '가전제품(7년)', months: 84 },
] as const;

const assetsPath = '/api/portfolio/assets';
const typeLabels: Record<AssetType, string> = {
  stock: '주식(ETF·펀드 포함)',
  real_estate: '부동산',
  cash: '현금(예적금 포함)',
  depreciable: '감가상각 대상',
  // Decision (2026-11-08): prepaid moved out of 기타 into its own type.
  prepaid: '선입금',
  other: '기타(코인 등)',
  debt: '부채',
};
const typeOrder = Object.keys(typeLabels) as AssetType[];
const typeLabel = (type: string) => typeLabels[type as AssetType] ?? type;
// #46 Types that can have buy and sell records (decision 2026-11-08).
const tradeableTypes: readonly AssetType[] = ['stock', 'other'];
const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';

const emptyDraft = (): Draft => ({
  name: '',
  type: 'cash',
  currency: 'KRW',
  quantity: '',
  value: '',
  memo: '',
  purchasePrice: '',
  purchasedOn: '',
  lifeMonths: '',
  salvage: '0',
  prepaidKind: 'amount',
  prepaidAmount: '',
  startsOn: '',
  expiresOn: '',
  security: null,
  manualPrice: '',
  manualPricedOn: '',
});

function prepaidBody(draft: Draft): { prepaid: object } | { field: Field; message: string } {
  const amountKrw = wonValue(draft.prepaidAmount);
  if (amountKrw === undefined) {
    return {
      field: 'prepaidAmount',
      message: '결제액은 1,000조 원 이하의 원 단위 정수로 입력하세요',
    };
  }
  if (draft.prepaidKind === 'period') {
    if (!realDate(draft.startsOn)) {
      return { field: 'startsOn', message: '시작일을 1900년부터 2100년 사이로 입력하세요' };
    }
    if (!realDate(draft.expiresOn)) {
      return { field: 'expiresOn', message: '만료일을 1900년부터 2100년 사이로 입력하세요' };
    }
    if (draft.startsOn > draft.expiresOn) {
      return { field: 'expiresOn', message: '만료일은 시작일과 같거나 뒤여야 합니다' };
    }
    return {
      prepaid: {
        kind: 'period',
        amountKrw,
        startsOn: draft.startsOn,
        expiresOn: draft.expiresOn,
      },
    };
  }
  if (draft.expiresOn && !realDate(draft.expiresOn)) {
    return { field: 'expiresOn', message: '만료일을 1900년부터 2100년 사이로 입력하세요' };
  }
  return {
    prepaid: { kind: 'amount', amountKrw, startsOn: null, expiresOn: draft.expiresOn || null },
  };
}

/** A whole-won amount up to 1,000조, or undefined when the text is not one. */
function wonValue(text: string) {
  const plain = digits(text);
  if (!/^\d{1,16}$/.test(plain) || Number(plain) > 1e15) return undefined;
  return Number(plain);
}

function depreciationBody(
  draft: Draft,
): { depreciation: Depreciation } | { field: Field; message: string } {
  const purchasePriceKrw = wonValue(draft.purchasePrice);
  if (purchasePriceKrw === undefined) {
    return {
      field: 'purchasePrice',
      message: '구입가는 1,000조 원 이하의 원 단위 정수로 입력하세요',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.purchasedOn)) {
    return { field: 'purchasedOn', message: '구입일을 입력하세요' };
  }
  // Same range as the server (and the date input's min/max).
  if (draft.purchasedOn < minDate || draft.purchasedOn > maxDate) {
    return { field: 'purchasedOn', message: '구입일은 1900년부터 2100년 사이로 입력하세요' };
  }
  const lifeText = draft.lifeMonths.trim();
  if (!/^\d{1,4}$/.test(lifeText) || Number(lifeText) < 1 || Number(lifeText) > 1200) {
    return { field: 'lifeMonths', message: '사용 기간은 1~1200개월 사이의 정수로 입력하세요' };
  }
  const salvageValueKrw = draft.salvage.trim() === '' ? 0 : wonValue(draft.salvage);
  if (salvageValueKrw === undefined) {
    return { field: 'salvage', message: '잔존 가치는 원 단위 정수로 입력하세요' };
  }
  if (salvageValueKrw > purchasePriceKrw) {
    return { field: 'salvage', message: '잔존 가치는 구입가보다 클 수 없습니다' };
  }
  return {
    depreciation: {
      purchasePriceKrw,
      purchasedOn: draft.purchasedOn,
      usefulLifeMonths: Number(lifeText),
      salvageValueKrw,
    },
  };
}

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
function toBody(
  draft: Draft,
  tradeManaged = false,
): { body: object } | { field: Field; message: string } {
  const name = draft.name.trim();
  if (!name) return { field: 'name', message: '자산 이름을 입력하세요' };
  if (draft.type === 'prepaid') {
    const result = prepaidBody(draft);
    if ('field' in result) return result;
    return {
      body: {
        name,
        type: draft.type,
        currency: 'KRW',
        quantity: null,
        valueKrw: null,
        valueForeign: null,
        memo: draft.memo,
        prepaid: result.prepaid,
      },
    };
  }
  if (draft.type === 'depreciable') {
    const result = depreciationBody(draft);
    if ('field' in result) return result;
    return {
      body: {
        name,
        type: draft.type,
        currency: 'KRW',
        quantity: null,
        valueKrw: null,
        valueForeign: null,
        memo: draft.memo,
        depreciation: result.depreciation,
      },
    };
  }
  const quantityText = draft.type === 'debt' ? '' : digits(draft.quantity);
  if (
    quantityText &&
    (!/^\d{1,12}(\.\d{1,8})?$/.test(quantityText) || !/[1-9]/.test(quantityText))
  ) {
    return { field: 'quantity', message: '수량은 0보다 큰 수로, 소수 8자리까지 입력하세요' };
  }
  const security = draft.type === 'stock' ? draft.security : null;
  // A linked stock is valued at quantity × close only (decision 2026-11-10): no value is sent with it.
  if (security !== null && !tradeManaged && !quantityText) {
    return { field: 'quantity', message: '종목을 연결하려면 수량을 입력하세요' };
  }
  const valueText = security !== null ? '' : digits(draft.value);
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
  // An asset with trades may hold nothing (all sold) and still be edited.
  if (!tradeManaged && !quantityText && valueKrw === null && valueForeign === null) {
    return { field: 'value', message: '수량이 없는 자산은 평가금액을 입력하세요' };
  }
  const price = handPrice(draft, security !== null);
  if (price !== null && 'field' in price) return price;
  if (price !== null && !quantityText && !tradeManaged) {
    return { field: 'quantity', message: '현재가를 넣으려면 수량을 입력하세요' };
  }
  return {
    body: {
      name,
      type: draft.type,
      // A linked asset is in the security's currency (decision 2026-11-10).
      currency: security?.currency ?? draft.currency,
      quantity: quantityText || null,
      valueKrw,
      valueForeign,
      memo: draft.memo,
      securityId: security?.id ?? null,
      manualPrice: price,
    },
  };
}

/**
 * #47 The price entered by hand for an unlinked stock or other asset: null when left empty, else the body
 * part or the wrong field. A price without a date is from today.
 */
function handPrice(
  draft: Draft,
  linked: boolean,
): { price: string; pricedOn: string } | { field: Field; message: string } | null {
  if (!tradeableTypes.includes(draft.type) || linked) return null;
  const price = digits(draft.manualPrice);
  if (!price && !draft.manualPricedOn) return null;
  if (!price) return { field: 'manualPrice', message: '현재가를 입력하세요' };
  const pattern = draft.currency === 'KRW' ? /^\d{1,16}$/ : /^\d{1,16}(\.\d{1,4})?$/;
  if (!pattern.test(price) || !/[1-9]/.test(price)) {
    return {
      field: 'manualPrice',
      message:
        draft.currency === 'KRW'
          ? '현재가는 0보다 큰 원 단위 정수로 입력하세요'
          : '현재가는 0보다 큰 수로, 소수 4자리까지 입력하세요',
    };
  }
  const pricedOn = draft.manualPricedOn || serviceToday();
  if (!realDate(pricedOn)) {
    return {
      field: 'manualPricedOn',
      message: '현재가 기준일을 1900년부터 2100년 사이로 입력하세요',
    };
  }
  return { price, pricedOn };
}

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);

function valueText(asset: Asset) {
  if (asset.currentValueKrw !== null) return formatWon(asset.currentValueKrw);
  if (asset.currentValueForeign !== null) return formatUsd(asset.currentValueForeign);
  if (asset.valueIssue === 'too_large') return '너무 커서 표시할 수 없음';
  return asset.valueIssue === 'no_price' && asset.quantity !== null ? '시세 없음' : '평가금액 없음';
}

/**
 * #47 Where the value comes from, one line each (docs/price-source.md): the price and its date, "시세 지연" for a
 * close more than 5 days old, "직접 입력" for a hand price, "거래 중단", the USD rate, and why a value is left
 * out of the totals. Then the gain of an asset with trades, or "원가 없음" for a priced one without them.
 */
function valuationLines(asset: Asset) {
  const lines: string[] = [];
  const { price, fx } = asset;
  if (
    asset.currency === 'USD' &&
    asset.currentValueKrw !== null &&
    asset.currentValueForeign !== null
  ) {
    lines.push(formatUsd(asset.currentValueForeign));
  }
  if (price) {
    lines.push(
      price.source === 'close'
        ? `${formatPrice(price.price, price.currency)} · ${price.stale ? '시세 지연 · ' : ''}${formatMonthDay(price.date)} 종가 기준`
        : `${formatPrice(price.price, price.currency)} · 직접 입력 · ${formatMonthDay(price.date)}`,
    );
  }
  if (asset.security && !asset.security.active) lines.push('거래 중단');
  if (fx) {
    lines.push(
      `환율 ${formatDecimal(fx.fxRate)}원 · ${fx.stale ? '환율 지연 · ' : ''}${formatMonthDay(fx.rateDate)} 기준`,
    );
  }
  if (asset.valueIssue === 'no_fx') lines.push('환율 없음 · 합계에서 뺐습니다');
  if (asset.valueIssue === 'no_price') {
    lines.push(
      asset.security
        ? '아직 받은 종가가 없어 합계에서 뺐습니다'
        : '평가금액이 없어 합계에서 뺐습니다',
    );
  }
  if (asset.valueIssue === 'too_large') lines.push('값이 너무 커서 합계에서 뺐습니다');
  if (asset.hasTrades && asset.profitKrw !== null) {
    const rate =
      asset.returnPercent === null
        ? ''
        : ` (${asset.returnPercent.startsWith('-') ? '' : '+'}${formatDecimal(asset.returnPercent)}%)`;
    lines.push(`평가 손익 ${signedWon(asset.profitKrw)}${rate}`);
  } else if (!asset.hasTrades && price) {
    lines.push('원가 없음 · 거래를 기록하면 손익을 보여 줍니다');
  }
  return lines;
}

/** "구입가 1,200,000원 · 2026-01-15 구입 · 사용 기간 60개월" (+ " · 잔존 가치 …" when not 0). */
function depreciationText(depreciation: Depreciation) {
  const salvage =
    depreciation.salvageValueKrw > 0
      ? ` · 잔존 가치 ${formatWon(depreciation.salvageValueKrw)}`
      : '';
  return `구입가 ${formatWon(depreciation.purchasePriceKrw)} · ${depreciation.purchasedOn} 구입 · 사용 기간 ${depreciation.usefulLifeMonths}개월${salvage}`;
}

/** "금액권 · 충전액 300,000원 · 사용 50,000원 · 2026-12-31 만료" or "기간권 · 결제액 … · 2026-01-01~2026-03-31". */
function prepaidText(prepaid: Prepaid) {
  if (prepaid.kind === 'period') {
    return `기간권 · 결제액 ${formatWon(prepaid.amountKrw)} · ${prepaid.startsOn}~${prepaid.expiresOn}`;
  }
  const expiry = prepaid.expiresOn ? ` · ${prepaid.expiresOn} 만료` : '';
  return `금액권 · 충전액 ${formatWon(prepaid.amountKrw)} · 사용 ${formatWon(prepaid.usedKrw)}${expiry}`;
}

export function AssetManager() {
  const [assets, setAssets] = useState<Asset[] | undefined>(undefined);
  const [totals, setTotals] = useState<Totals | undefined>(undefined);
  const [allocation, setAllocation] = useState<Allocation | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Asset | undefined>(undefined);
  const tradeManaged = editing?.hasTrades === true;
  // #47 A linked stock takes the security's currency and its stored close (no hand price).
  const linked = draft.type === 'stock' && draft.security !== null;
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
    const data = await requestJson<{ assets: Asset[]; totals: Totals; allocation: Allocation }>(
      assetsPath,
    );
    setAssets(data.assets);
    setTotals(data.totals);
    setAllocation(data.allocation);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, '자산을 불러오지 못했습니다'));
  }, [load, showError]);

  // Opening an edit moves focus to the form above the list (not when the same asset is refreshed below).
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId !== undefined) nameInput.current?.focus();
  }, [editingId]);

  // #46 A trade saved while the asset is open in the form changes whether its quantity comes from trades
  // and what it is: follow the fresh asset so the form never sends a quantity the server will refuse.
  useEffect(() => {
    if (!editing || !assets) return;
    const fresh = assets.find((asset) => asset.id === editing.id);
    if (!fresh) {
      // Deleted elsewhere (another tab): there is nothing left to save.
      setInvalid(undefined);
      setEditing(undefined);
      setDraft(emptyDraft());
      showError(`${editing.name}은(는) 이미 삭제되어 수정을 닫았습니다`);
      return;
    }
    if (fresh.hasTrades === editing.hasTrades && fresh.quantity === editing.quantity) return;
    setEditing(fresh);
    if (fresh.hasTrades || editing.hasTrades) {
      setDraft((current) => ({
        ...current,
        quantity: fresh.quantity === null ? '' : formatDecimal(fresh.quantity),
      }));
    }
  }, [assets, editing, showError]);

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
      // A #45 depreciable row has only a value: offer it as the purchase price instead of dropping it.
      purchasePrice: asset.depreciation
        ? String(asset.depreciation.purchasePriceKrw)
        : asset.type === 'depreciable' && asset.valueKrw !== null
          ? String(asset.valueKrw)
          : '',
      purchasedOn: asset.depreciation?.purchasedOn ?? '',
      lifeMonths: asset.depreciation ? String(asset.depreciation.usefulLifeMonths) : '',
      salvage: asset.depreciation ? String(asset.depreciation.salvageValueKrw) : '0',
      prepaidKind: asset.prepaid?.kind ?? 'amount',
      prepaidAmount: asset.prepaid ? String(asset.prepaid.amountKrw) : '',
      startsOn: asset.prepaid?.startsOn ?? '',
      expiresOn: asset.prepaid?.expiresOn ?? '',
      security: asset.security ? { ...asset.security, currency: asset.currency } : null,
      manualPrice: asset.manualPrice
        ? formatDecimal(asset.manualPrice.price).replaceAll(',', '')
        : '',
      manualPricedOn: asset.manualPrice?.pricedOn ?? '',
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
    const result = toBody(draft, tradeManaged);
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
      {allocation ? <AssetAllocation allocation={allocation} typeLabel={typeLabel} /> : null}
      <Card>
        <CardHeader>
          <CardTitle asHeading="h2">{editing ? '자산 수정' : '새 자산'}</CardTitle>
          <CardDescription>
            주식은 종목을 연결하면 받은 종가로, 연결하지 않으면 직접 넣은 현재가로 평가합니다. 달러
            자산은 저장된 최신 매매기준율로 원화로 바꿉니다. 감가상각 대상은 구입가에서 매달 같은
            금액을 빼 현재 가치를 계산합니다. 선입금은 결제한 날 가계부에 지출로 적고, 여기에는 남은
            가치만 둡니다.
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
            {draft.type === 'prepaid' ? (
              <>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-body-sm font-medium">선입금 종류</legend>
                  <div className="flex gap-4">
                    {(
                      [
                        ['amount', '금액권'],
                        ['period', '기간권'],
                      ] as const
                    ).map(([kind, label]) => (
                      <label key={kind} className="flex items-center gap-2 text-body-sm">
                        <input
                          type="radio"
                          name="asset-prepaid-kind"
                          value={kind}
                          checked={draft.prepaidKind === kind}
                          // A pass with uses is refused by the server; it says so.
                          onChange={() => change({ prepaidKind: kind })}
                          className="size-4 accent-primary"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-prepaid-amount">
                    {draft.prepaidKind === 'amount' ? '충전액(원)' : '결제액(원)'}
                  </Label>
                  <Input
                    id="asset-prepaid-amount"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="예: 300000"
                    value={draft.prepaidAmount}
                    {...fieldProps('prepaidAmount')}
                    onChange={(event) => {
                      clearInvalid('prepaidAmount');
                      change({ prepaidAmount: event.target.value });
                    }}
                  />
                </div>
                {draft.prepaidKind === 'period' ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="asset-starts-on">시작일</Label>
                    <Input
                      id="asset-starts-on"
                      type="date"
                      min={minDate}
                      max={maxDate}
                      value={draft.startsOn}
                      {...fieldProps('startsOn')}
                      onChange={(event) => {
                        clearInvalid('startsOn');
                        change({ startsOn: event.target.value });
                      }}
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-expires-on">
                    {draft.prepaidKind === 'period' ? '만료일(이날까지 사용)' : '만료일(선택)'}
                  </Label>
                  <Input
                    id="asset-expires-on"
                    type="date"
                    min={minDate}
                    max={maxDate}
                    value={draft.expiresOn}
                    {...fieldProps('expiresOn')}
                    onChange={(event) => {
                      clearInvalid('expiresOn');
                      change({ expiresOn: event.target.value });
                    }}
                  />
                </div>
              </>
            ) : draft.type === 'depreciable' ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-purchase-price">구입가(원)</Label>
                  <Input
                    id="asset-purchase-price"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="예: 1200000"
                    value={draft.purchasePrice}
                    {...fieldProps('purchasePrice')}
                    onChange={(event) => {
                      clearInvalid('purchasePrice');
                      change({ purchasePrice: event.target.value });
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-purchased-on">구입일</Label>
                  <Input
                    id="asset-purchased-on"
                    type="date"
                    min={minDate}
                    max={maxDate}
                    value={draft.purchasedOn}
                    {...fieldProps('purchasedOn')}
                    onChange={(event) => {
                      clearInvalid('purchasedOn');
                      change({ purchasedOn: event.target.value });
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-life-preset">기본 사용 기간</Label>
                  <select
                    id="asset-life-preset"
                    className={selectClass}
                    value={
                      lifePresets.find(
                        (preset) => String(preset.months) === draft.lifeMonths.trim(),
                      )?.months ?? ''
                    }
                    onChange={(event) => {
                      clearInvalid('lifeMonths');
                      change({ lifeMonths: event.target.value });
                    }}
                  >
                    <option value="">직접 입력</option>
                    {lifePresets.map((preset) => (
                      <option key={preset.months} value={preset.months}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-life-months">사용 기간(개월)</Label>
                  <Input
                    id="asset-life-months"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="예: 60"
                    value={draft.lifeMonths}
                    {...fieldProps('lifeMonths')}
                    onChange={(event) => {
                      clearInvalid('lifeMonths');
                      change({ lifeMonths: event.target.value });
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="asset-salvage">잔존 가치(원)</Label>
                  <Input
                    id="asset-salvage"
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.salvage}
                    {...fieldProps('salvage')}
                    onChange={(event) => {
                      clearInvalid('salvage');
                      change({ salvage: event.target.value });
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                {draft.type === 'stock' ? (
                  <SecurityPicker
                    value={draft.security}
                    locked={tradeManaged ? (editing?.currency ?? false) : false}
                    onChange={(security) =>
                      change(security ? { security, currency: security.currency } : { security })
                    }
                  />
                ) : null}
                <fieldset className="flex flex-col gap-2" disabled={linked}>
                  <legend className="mb-2 text-body-sm font-medium">
                    {linked ? '통화(종목 통화)' : '통화'}
                  </legend>
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
                    <Label htmlFor="asset-quantity">
                      {tradeManaged ? '수량(거래 합계)' : '수량(선택)'}
                    </Label>
                    <Input
                      id="asset-quantity"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={tradeManaged ? '0' : '예: 10 또는 0.5'}
                      value={draft.quantity}
                      // #46 Decision: an asset with trades takes its quantity from them.
                      readOnly={tradeManaged}
                      {...fieldProps('quantity')}
                      aria-describedby={
                        tradeManaged
                          ? 'asset-quantity-hint'
                          : fieldProps('quantity')['aria-describedby']
                      }
                      onChange={(event) => {
                        clearInvalid('quantity');
                        change({ quantity: event.target.value });
                      }}
                    />
                    {tradeManaged ? (
                      <p id="asset-quantity-hint" className="text-caption text-muted-foreground">
                        거래 기록이 있어 수량은 거래 내역에서만 바뀝니다.
                      </p>
                    ) : null}
                  </div>
                )}
                {linked ? null : (
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
                )}
                {tradeableTypes.includes(draft.type) && !linked ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="asset-manual-price">
                        현재가(1개당, {draft.currency === 'KRW' ? '원' : '달러'}, 선택)
                      </Label>
                      <Input
                        id="asset-manual-price"
                        inputMode={draft.currency === 'KRW' ? 'numeric' : 'decimal'}
                        autoComplete="off"
                        placeholder={draft.currency === 'KRW' ? '예: 95000000' : '예: 12.34'}
                        value={draft.manualPrice}
                        {...fieldProps('manualPrice')}
                        aria-describedby={
                          fieldProps('manualPrice')['aria-describedby'] ?? 'asset-manual-price-hint'
                        }
                        onChange={(event) => {
                          clearInvalid('manualPrice');
                          change({ manualPrice: event.target.value });
                        }}
                      />
                      <p
                        id="asset-manual-price-hint"
                        className="text-caption text-muted-foreground"
                      >
                        시세를 받지 않는 자산은 수량 × 현재가로 평가합니다.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="asset-manual-priced-on">현재가 기준일(비우면 오늘)</Label>
                      <Input
                        id="asset-manual-priced-on"
                        type="date"
                        min={minDate}
                        max={maxDate}
                        value={draft.manualPricedOn}
                        {...fieldProps('manualPricedOn')}
                        onChange={(event) => {
                          clearInvalid('manualPricedOn');
                          change({ manualPricedOn: event.target.value });
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </>
            )}
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
          onUsagesChanged={load}
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
          ? ` 시세·환율이 없거나 평가금액이 없는 ${totals.uncounted}개는 합계에서 빠졌습니다.`
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
  onUsagesChanged,
}: {
  assets: Asset[] | undefined;
  failed: boolean;
  onEdit: (asset: Asset) => void;
  onDelete: (asset: Asset) => Promise<void>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onDeleteOpen: () => void;
  onUsagesChanged: () => Promise<void>;
}) {
  // The stored-value asset whose uses are open, one at a time.
  const [openUsages, setOpenUsages] = useState<number | undefined>(undefined);
  // The stock or other asset whose trades are open, one at a time.
  const [openTrades, setOpenTrades] = useState<number | undefined>(undefined);
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
                        {asset.depreciation
                          ? depreciationText(asset.depreciation)
                          : asset.prepaid
                            ? prepaidText(asset.prepaid)
                            : asset.security
                              ? `${securityText(asset.security)} · ${asset.currency}`
                              : asset.currency}
                        {asset.quantity === null ? '' : ` · 수량 ${formatDecimal(asset.quantity)}`}
                        {asset.memo ? ` · ${asset.memo}` : ''}
                      </span>
                      {valuationLines(asset).map((line) => (
                        <span key={line} className="text-caption text-muted-foreground">
                          {line}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{valueText(asset)}</span>
                      {asset.prepaid?.kind === 'amount' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={openUsages === asset.id}
                          // Only while the panel exists, so it never points at a missing id.
                          aria-controls={
                            openUsages === asset.id ? `usage-${asset.id}-panel` : undefined
                          }
                          aria-label={`${asset.name} 사용 기록`}
                          onClick={() =>
                            setOpenUsages((open) => (open === asset.id ? undefined : asset.id))
                          }
                        >
                          사용 기록
                        </Button>
                      ) : null}
                      {tradeableTypes.includes(asset.type) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={openTrades === asset.id}
                          aria-controls={
                            openTrades === asset.id ? `trade-${asset.id}-panel` : undefined
                          }
                          aria-label={`${asset.name} 거래 내역`}
                          onClick={() =>
                            setOpenTrades((open) => (open === asset.id ? undefined : asset.id))
                          }
                        >
                          거래 내역
                        </Button>
                      ) : null}
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
                    {asset.prepaid?.kind === 'amount' && openUsages === asset.id ? (
                      <div id={`usage-${asset.id}-panel`} className="w-full">
                        <PrepaidUsages
                          assetId={asset.id}
                          assetName={asset.name}
                          onChanged={onUsagesChanged}
                        />
                      </div>
                    ) : null}
                    {tradeableTypes.includes(asset.type) && openTrades === asset.id ? (
                      <div id={`trade-${asset.id}-panel`} className="w-full">
                        <AssetTrades
                          assetId={asset.id}
                          assetName={asset.name}
                          currency={asset.currency}
                          handQuantity={asset.hasTrades ? null : asset.quantity}
                          latestFx={asset.fx}
                          onChanged={onUsagesChanged}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
