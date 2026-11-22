import {
  countOf,
  formatDecimal,
  formatUsd,
  formatWon,
  realDate,
  serviceToday,
  withoutThousands as digits,
} from './format';
import { formatMonthDay, formatPrice, quoteBasis } from './quote-format';
import type { LinkedSecurity } from './security-picker';

// #190 The asset screen's types, constants, and pure helpers (request bodies, value lines), kept apart from
// the components so they can be unit-tested.
// The history of the screen (#45-#64) is at the top of assets.tsx.

export type AssetType =
  'stock' | 'real_estate' | 'cash' | 'debt' | 'depreciable' | 'prepaid' | 'other';
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
export type Asset = {
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
export type Totals = {
  assetsKrw: number | null;
  debtsKrw: number | null;
  netKrw: number | null;
  uncounted: number;
};
export type Draft = {
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
export type Field =
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

export const minDate = '1900-01-01';
export const maxDate = '2100-12-31';

// Decision (2026-11-02): default useful lives, editable after choosing.
export const lifePresets = [
  { label: 'Bed (10 years)', months: 120 },
  { label: 'Computer (5 years)', months: 60 },
  { label: 'Appliance (7 years)', months: 84 },
] as const;

export const assetsPath = '/api/portfolio/assets';
export const typeLabels: Record<AssetType, string> = {
  stock: 'Stocks (incl. ETFs and funds)',
  real_estate: 'Real estate',
  cash: 'Cash (incl. savings)',
  depreciable: 'Depreciable',
  // Decision (2026-11-08): prepaid moved out of Other into its own type.
  prepaid: 'Prepaid',
  other: 'Other (crypto, etc.)',
  debt: 'Liability',
};
export const typeOrder = Object.keys(typeLabels) as AssetType[];
export const typeLabel = (type: string) => typeLabels[type as AssetType] ?? type;
// #46 Types that can have buy and sell records (decision 2026-11-08).
export const tradeableTypes: readonly AssetType[] = ['stock', 'other'];
export const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';

export const emptyDraft = (): Draft => ({
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

export function prepaidBody(draft: Draft): { prepaid: object } | { field: Field; message: string } {
  const amountKrw = wonValue(draft.prepaidAmount);
  if (amountKrw === undefined) {
    return {
      field: 'prepaidAmount',
      message: 'Enter the amount paid as a whole number of won, up to ₩1 quadrillion',
    };
  }
  if (draft.prepaidKind === 'period') {
    if (!realDate(draft.startsOn)) {
      return { field: 'startsOn', message: 'Enter a start date between 1900 and 2100' };
    }
    if (!realDate(draft.expiresOn)) {
      return { field: 'expiresOn', message: 'Enter an expiry date between 1900 and 2100' };
    }
    if (draft.startsOn > draft.expiresOn) {
      return { field: 'expiresOn', message: 'The expiry date must be on or after the start date' };
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
    return { field: 'expiresOn', message: 'Enter an expiry date between 1900 and 2100' };
  }
  return {
    prepaid: { kind: 'amount', amountKrw, startsOn: null, expiresOn: draft.expiresOn || null },
  };
}

/** A whole-won amount up to ₩1 quadrillion, or undefined when the text is not one. */
function wonValue(text: string) {
  const plain = digits(text);
  if (!/^\d{1,16}$/.test(plain) || Number(plain) > 1e15) return undefined;
  return Number(plain);
}

export function depreciationBody(
  draft: Draft,
): { depreciation: Depreciation } | { field: Field; message: string } {
  const purchasePriceKrw = wonValue(draft.purchasePrice);
  if (purchasePriceKrw === undefined) {
    return {
      field: 'purchasePrice',
      message: 'Enter the purchase price as a whole number of won, up to ₩1 quadrillion',
    };
  }
  if (draft.purchasedOn.trim() === '') {
    return { field: 'purchasedOn', message: 'Enter the purchase date' };
  }
  // #189 A real calendar date in the server's range (and the date input's min/max): 2026-02-30 is refused.
  if (!realDate(draft.purchasedOn)) {
    return { field: 'purchasedOn', message: 'Enter a purchase date between 1900 and 2100' };
  }
  const lifeText = draft.lifeMonths.trim();
  if (!/^\d{1,4}$/.test(lifeText) || Number(lifeText) < 1 || Number(lifeText) > 1200) {
    return {
      field: 'lifeMonths',
      message: 'Enter a useful life as a whole number from 1 to 1200 months',
    };
  }
  const salvageValueKrw = draft.salvage.trim() === '' ? 0 : wonValue(draft.salvage);
  if (salvageValueKrw === undefined) {
    return { field: 'salvage', message: 'Enter the salvage value as a whole number of won' };
  }
  if (salvageValueKrw > purchasePriceKrw) {
    return {
      field: 'salvage',
      message: 'The salvage value cannot be more than the purchase price',
    };
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

export const totalText = (value: number | null) =>
  value === null ? 'Too large to show' : value < 0 ? `-${formatWon(-value)}` : formatWon(value);

/**
 * The request body for a draft, or the field and message that is wrong. Mirrors the server rules
 * so the common mistakes are caught before sending; the server checks again.
 */
export function toBody(
  draft: Draft,
  tradeManaged = false,
): { body: object } | { field: Field; message: string } {
  const name = draft.name.trim();
  if (!name) return { field: 'name', message: 'Enter an asset name' };
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
    return { field: 'quantity', message: 'Enter a quantity above 0 with up to 8 decimal places' };
  }
  const security = draft.type === 'stock' ? draft.security : null;
  // A linked stock is valued at quantity × close only (decision 2026-11-10): no value is sent with it.
  if (security !== null && !tradeManaged && !quantityText) {
    return { field: 'quantity', message: 'Enter a quantity to link a security' };
  }
  const valueText = security !== null ? '' : digits(draft.value);
  let valueKrw: number | null = null;
  let valueForeign: string | null = null;
  if (valueText && draft.currency === 'KRW') {
    if (!/^\d{1,16}$/.test(valueText)) {
      return { field: 'value', message: 'Enter the valuation in won as a whole number, 0 or more' };
    }
    if (Number(valueText) > 1e15) {
      return { field: 'value', message: 'Enter a valuation of ₩1 quadrillion or less' };
    }
    valueKrw = Number(valueText);
  }
  if (valueText && draft.currency === 'USD') {
    if (!/^\d{1,16}(\.\d{1,4})?$/.test(valueText)) {
      return { field: 'value', message: 'Enter a dollar valuation with up to 4 decimal places' };
    }
    valueForeign = valueText;
  }
  // An asset with trades may hold nothing (all sold) and still be edited.
  if (!tradeManaged && !quantityText && valueKrw === null && valueForeign === null) {
    return { field: 'value', message: 'Enter a valuation for an asset without a quantity' };
  }
  const price = handPrice(draft, security !== null);
  if (price !== null && 'field' in price) return price;
  if (price !== null && !quantityText && !tradeManaged) {
    return { field: 'quantity', message: 'Enter a quantity to set a current price' };
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
export function handPrice(
  draft: Draft,
  linked: boolean,
): { price: string; pricedOn: string } | { field: Field; message: string } | null {
  if (!tradeableTypes.includes(draft.type) || linked) return null;
  const price = digits(draft.manualPrice);
  if (!price && !draft.manualPricedOn) return null;
  if (!price) return { field: 'manualPrice', message: 'Enter the current price' };
  const pattern = draft.currency === 'KRW' ? /^\d{1,16}$/ : /^\d{1,16}(\.\d{1,4})?$/;
  if (!pattern.test(price) || !/[1-9]/.test(price)) {
    return {
      field: 'manualPrice',
      message:
        draft.currency === 'KRW'
          ? 'Enter a current price above 0 as a whole number of won'
          : 'Enter a current price above 0 with up to 4 decimal places',
    };
  }
  const pricedOn = draft.manualPricedOn || serviceToday();
  if (!realDate(pricedOn)) {
    return {
      field: 'manualPricedOn',
      message: 'Enter a current-price date between 1900 and 2100',
    };
  }
  return { price, pricedOn };
}

const signedWon = (amount: number) =>
  amount > 0 ? `+${formatWon(amount)}` : amount < 0 ? `-${formatWon(-amount)}` : formatWon(0);

export function valueText(asset: Asset) {
  if (asset.currentValueKrw !== null) return formatWon(asset.currentValueKrw);
  if (asset.currentValueForeign !== null) return formatUsd(asset.currentValueForeign);
  if (asset.valueIssue === 'too_large') return 'Too large to show';
  return asset.valueIssue === 'no_price' && asset.quantity !== null ? 'No quote' : 'No valuation';
}

/**
 * #47 Where the value comes from, one line each (docs/price-source.md): the price and its date, "Delayed" for a
 * close more than 5 days old, "Entered by hand" for a hand price, "Trading halted", the USD rate, and why a value is left
 * out of the totals. Then the gain of an asset with trades, or "No cost basis" for a priced one without them.
 */
export function valuationLines(asset: Asset) {
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
        ? `${formatPrice(price.price, price.currency)} · ${quoteBasis({ tradeDate: price.date, stale: price.stale })}`
        : `${formatPrice(price.price, price.currency)} · Entered by hand · ${formatMonthDay(price.date)}`,
    );
  }
  if (asset.security && !asset.security.active) lines.push('Trading halted');
  if (fx) {
    lines.push(
      `Exchange rate ₩${formatDecimal(fx.fxRate)} · ${fx.stale ? 'Rate delayed · ' : ''}as of ${formatMonthDay(fx.rateDate)}`,
    );
  }
  if (asset.valueIssue === 'no_fx') lines.push('No exchange rate · left out of the totals');
  if (asset.valueIssue === 'no_price') {
    lines.push(
      asset.security
        ? 'No close received yet, so it is left out of the totals'
        : 'No valuation, so it is left out of the totals',
    );
  }
  if (asset.valueIssue === 'too_large')
    lines.push('Value too large, so it is left out of the totals');
  if (asset.hasTrades && asset.profitKrw !== null) {
    const rate =
      asset.returnPercent === null
        ? ''
        : ` (${asset.returnPercent.startsWith('-') ? '' : '+'}${formatDecimal(asset.returnPercent)}%)`;
    lines.push(`Valuation gain/loss ${signedWon(asset.profitKrw)}${rate}`);
  } else if (!asset.hasTrades && price) {
    lines.push('No cost basis · record a trade to see gain/loss');
  }
  return lines;
}

/** "Purchase price ₩1,200,000 · purchased 2026-01-15 · useful life 60 months" (+ " · salvage value …" when not 0). */
export function depreciationText(depreciation: Depreciation) {
  const salvage =
    depreciation.salvageValueKrw > 0
      ? ` · salvage value ${formatWon(depreciation.salvageValueKrw)}`
      : '';
  return `Purchase price ${formatWon(depreciation.purchasePriceKrw)} · purchased ${depreciation.purchasedOn} · useful life ${countOf(depreciation.usefulLifeMonths, 'month')}${salvage}`;
}

/** "Voucher · loaded ₩300,000 · used ₩50,000 · expires 2026-12-31" or "Pass · paid … · 2026-01-01~2026-03-31". */
export function prepaidText(prepaid: Prepaid) {
  if (prepaid.kind === 'period') {
    return `Pass · paid ${formatWon(prepaid.amountKrw)} · ${prepaid.startsOn}~${prepaid.expiresOn}`;
  }
  const expiry = prepaid.expiresOn ? ` · expires ${prepaid.expiresOn}` : '';
  return `Voucher · loaded ${formatWon(prepaid.amountKrw)} · used ${formatWon(prepaid.usedKrw)}${expiry}`;
}

/** The form draft for editing an asset: its stored fields as the inputs show them. */
export function draftFromAsset(asset: Asset): Draft {
  return {
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
  };
}
