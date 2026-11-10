import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { readAllocation } from './allocation.js';
import { inTransaction } from './db.js';
import { date } from './entries.js';
import { particles } from './korean.js';
import { fetchUsCloses, type PriceLog, tiingoHourlyLimit } from './prices/fetch.js';
import type { PriceSources } from './prices/sources.js';
import { HttpError, parseId } from './standard/http.js';
import { tradesRouter } from './trades.js';

// #45 Held assets and debts. Formats follow AGENTS.project.md "수량·외화·환율" (#35):
// won amounts are JSON numbers (bigint in the DB), quantities and USD amounts are decimal strings.
// Trades and average prices come with #46, prices and FX conversion with #47.
// #63 A depreciating asset stores its purchase price, date, useful life and salvage value instead of a value;
// the server works out its current value for a reference date (straight-line by month, migration 007).
// #64 A prepaid asset (hair salon, gym) is a stored-value 'amount' with uses, or a 'period' pass; its value
// comes from what was paid (migration 010). Paying is a ledger expense, so using it is not one again.
// #47 A stock asset can be linked to a security and is valued at the newest stored close; an unlinked stock or
// other asset can carry a price entered by hand. USD values are converted with the newest stored USD rate, and
// assets with trades show their gain against the won cost (migration 016, decisions 2026-11-10).

const maxWon = 1_000_000_000_000_000;

const assetTypes = [
  'stock',
  'real_estate',
  'cash',
  'debt',
  'depreciable',
  'prepaid',
  'other',
] as const;

// Up to 12 integer and 8 fractional digits: numeric(20,8).
const quantityPattern = /^\d{1,12}(\.\d{1,8})?$/;
// Up to 16 integer and 4 fractional digits: numeric(20,4).
const foreignPattern = /^\d{1,16}(\.\d{1,4})?$/;

const wonAmount = (label: string) => {
  const { topic, object } = particles(label);
  return z
    .number({ error: `${label}${object} 숫자로 입력하세요` })
    .int(`${label}${topic} 원 단위 정수로 입력하세요`)
    .min(0, `${label}${topic} 0 이상이어야 합니다`)
    .max(maxWon, `${label}${topic} 1,000조 원 이하로 입력하세요`);
};

const depreciation = z.object(
  {
    purchasePriceKrw: wonAmount('구입가'),
    purchasedOn: date,
    usefulLifeMonths: z
      .number({ error: '사용 기간을 개월 수로 입력하세요' })
      .int('사용 기간은 개월 단위 정수로 입력하세요')
      .min(1, '사용 기간은 1개월 이상이어야 합니다')
      .max(1200, '사용 기간은 1200개월(100년) 이하로 입력하세요'),
    // Decision (2026-11-02): no salvage value unless one is entered.
    salvageValueKrw: wonAmount('잔존 가치').default(0),
  },
  { error: '감가상각 정보는 객체로 보내세요' },
);

const prepaid = z.object(
  {
    kind: z.enum(['amount', 'period'], {
      error: '선입금 종류는 금액권 또는 기간권 중에서 고르세요',
    }),
    amountKrw: wonAmount('결제액'),
    // A period pass only; a stored-value one has no start.
    startsOn: date.nullable().default(null),
    // Required for a period pass, optional for a stored-value one (decision 2026-11-08).
    expiresOn: date.nullable().default(null),
  },
  { error: '선입금 정보는 객체로 보내세요' },
);

const manualPrice = z.object(
  {
    price: z
      .string({ error: '현재가는 소수 문자열로 보내세요' })
      .regex(foreignPattern, {
        error: '현재가는 정수 16자리, 소수 4자리까지 입력하세요',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), '현재가는 0보다 커야 합니다'),
    pricedOn: date,
  },
  { error: '직접 입력한 현재가는 객체로 보내세요' },
);

const usageBody = z.object(
  {
    usedOn: date,
    amountKrw: z
      .number({ error: '사용 금액을 숫자로 입력하세요' })
      .int('사용 금액은 원 단위 정수로 입력하세요')
      .min(1, '사용 금액은 1원 이상이어야 합니다')
      .max(maxWon, '사용 금액은 1,000조 원 이하로 입력하세요'),
    memo: z
      .string({ error: '메모는 글자로 입력하세요' })
      .trim()
      .max(100, '메모는 100자 이하로 입력하세요')
      .default(''),
  },
  { error: '요청 본문은 JSON 객체여야 합니다' },
);

// #46 Types that can have buy and sell records (decision 2026-11-08); #47 also the ones a hand price fits.
const tradeableTypes: readonly string[] = ['stock', 'other'];

const assetBody = z
  .object(
    {
      name: z
        .string({ error: '자산 이름을 입력하세요' })
        .trim()
        .normalize('NFC')
        .min(1, '자산 이름을 입력하세요')
        .max(50, '자산 이름은 50자 이하로 입력하세요'),
      type: z.enum(assetTypes, { error: '자산 종류를 고르세요' }),
      currency: z.enum(['KRW', 'USD'], { error: '통화는 KRW 또는 USD 중에서 고르세요' }),
      quantity: z
        .string({ error: '수량은 소수 문자열로 보내세요' })
        .regex(quantityPattern, {
          error: '수량은 정수 12자리, 소수 8자리까지 입력하세요',
          abort: true,
        })
        .refine((value) => /[1-9]/.test(value), '수량은 0보다 커야 합니다')
        .nullable()
        .default(null),
      valueKrw: z
        .number({ error: '평가금액을 숫자로 입력하세요' })
        .int('원화 평가금액은 원 단위 정수로 입력하세요')
        .min(0, '평가금액은 0 이상이어야 합니다')
        // 1,000조 원: far above any household asset, and low enough that thousands of them still total
        // to a safe integer. Totals that still overflow are reported as null rather than failing the list.
        .max(maxWon, '평가금액은 1,000조 원 이하로 입력하세요')
        .nullable()
        .default(null),
      valueForeign: z
        .string({ error: '외화 평가금액은 소수 문자열로 보내세요' })
        .regex(foreignPattern, '외화 평가금액은 정수 16자리, 소수 4자리까지 입력하세요')
        .nullable()
        .default(null),
      memo: z
        .string({ error: '메모는 글자로 입력하세요' })
        .trim()
        .max(200, '메모는 200자 이하로 입력하세요')
        .default(''),
      depreciation: depreciation.nullable().default(null),
      prepaid: prepaid.nullable().default(null),
      securityId: z
        .number({ error: '종목 번호를 숫자로 보내세요' })
        .int('종목 번호를 확인하세요')
        .positive('종목 번호를 확인하세요')
        .max(Number.MAX_SAFE_INTEGER, '종목 번호를 확인하세요')
        .nullable()
        .default(null),
      manualPrice: manualPrice.nullable().default(null),
    },
    { error: '요청 본문은 JSON 객체여야 합니다' },
  )
  .superRefine((body, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (body.currency === 'KRW' && body.valueForeign !== null) {
      issue('원화 자산의 평가금액은 원 단위로 입력하세요');
    }
    if (body.currency === 'USD' && body.valueKrw !== null) {
      issue('달러 자산의 평가금액은 달러로 입력하세요');
    }
    if (body.type !== 'depreciable' && body.depreciation !== null) {
      issue('감가상각 정보는 감가상각 자산에만 넣을 수 있습니다');
    }
    if (body.type !== 'prepaid' && body.prepaid !== null) {
      issue('선입금 정보는 선입금 자산에만 넣을 수 있습니다');
    }
    if (body.type !== 'stock' && body.securityId !== null) {
      issue('종목은 주식 자산에만 연결할 수 있습니다');
    }
    // A linked asset is quantity × close only: a value typed before (maybe in another currency) is never used.
    if (body.securityId !== null && (body.valueKrw !== null || body.valueForeign !== null)) {
      issue('종목에 연결한 자산은 받은 종가로 평가하므로 평가금액을 입력하지 않습니다');
    }
    if (body.manualPrice !== null) {
      if (!tradeableTypes.includes(body.type)) {
        issue('현재가는 주식이나 기타(코인 등) 자산에만 입력할 수 있습니다');
      } else if (body.securityId !== null) {
        issue('종목에 연결한 자산은 받은 종가로 평가하므로 현재가를 입력하지 않습니다');
      } else if (body.currency === 'KRW' && /\.\d*[1-9]/.test(body.manualPrice.price)) {
        issue('원화 현재가는 원 단위 정수로 입력하세요');
      }
    }
    if (body.type === 'prepaid') {
      if (body.prepaid === null) {
        issue('선입금 자산은 금액권·기간권과 결제액을 입력하세요');
        return;
      }
      if (body.currency !== 'KRW') issue('선입금 자산은 원화로 입력하세요');
      if (body.quantity !== null || body.valueKrw !== null || body.valueForeign !== null) {
        issue('선입금 자산은 평가금액 대신 결제액으로 현재 가치를 계산합니다');
      }
      const { kind, startsOn, expiresOn } = body.prepaid;
      if (kind === 'amount' && startsOn !== null) {
        issue('금액권에는 시작일을 넣지 않습니다');
      }
      if (kind === 'period') {
        if (startsOn === null || expiresOn === null) {
          issue('기간권은 시작일과 만료일을 입력하세요');
        } else if (startsOn > expiresOn) {
          issue('만료일은 시작일과 같거나 뒤여야 합니다');
        }
      }
      return;
    }
    if (body.type === 'depreciable') {
      if (body.depreciation === null) {
        issue('감가상각 자산은 구입가, 구입일, 사용 기간을 입력하세요');
        return;
      }
      if (body.currency !== 'KRW') issue('감가상각 자산은 원화로 입력하세요');
      if (body.quantity !== null || body.valueKrw !== null || body.valueForeign !== null) {
        issue('감가상각 자산은 평가금액 대신 구입가로 현재 가치를 계산합니다');
      }
      const { purchasePriceKrw, salvageValueKrw } = body.depreciation;
      // A negative price already has its own message.
      if (purchasePriceKrw >= 0 && salvageValueKrw > purchasePriceKrw) {
        issue('잔존 가치는 구입가보다 클 수 없습니다');
      }
      return;
    }
    if (body.type === 'debt' && body.quantity !== null) {
      issue('부채에는 수량을 넣을 수 없습니다');
    }
  });

const listQuery = z.object({ asOf: date.optional() });

/**
 * A plain asset needs a quantity or a value. Checked outside the schema because an asset whose quantity
 * comes from trades may hold nothing (everything sold) and still be edited.
 */
function requireQuantityOrValue(body: z.infer<typeof assetBody>) {
  if (body.type === 'depreciable' || body.type === 'prepaid') return;
  if (body.quantity === null && body.securityId !== null) {
    throw new HttpError(400, '종목을 연결하려면 수량을 입력하세요');
  }
  if (body.quantity === null && body.valueKrw === null && body.valueForeign === null) {
    throw new HttpError(400, '수량이 없는 자산은 평가금액을 입력하세요');
  }
  if (body.quantity === null && body.manualPrice !== null) {
    throw new HttpError(400, '현재가를 넣으려면 수량을 입력하세요');
  }
}

type Row = {
  id: string;
  name: string;
  asset_type: (typeof assetTypes)[number];
  currency: 'KRW' | 'USD';
  quantity: string | null;
  value_krw: string | null;
  value_foreign: string | null;
  memo: string;
  purchase_price_krw: string | null;
  purchased_on: string | null;
  useful_life_months: number | null;
  salvage_value_krw: string | null;
  prepaid_kind: 'amount' | 'period' | null;
  prepaid_amount_krw: string | null;
  prepaid_starts_on: string | null;
  prepaid_expires_on: string | null;
  prepaid_used_krw: string;
  has_trades: boolean;
  security_id: string | null;
  security_market: string | null;
  security_symbol: string | null;
  security_name: string | null;
  security_active: boolean | null;
  manual_price: string | null;
  manual_price_on: string | null;
  unit_price: string | null;
  price_date: string | null;
  price_stale: boolean | null;
  fx_rate: string | null;
  fx_date: string | null;
  fx_stale: boolean | null;
  current_value_foreign: string | null;
  value_issue: 'no_price' | 'no_fx' | 'too_large' | null;
  cost_krw: string | null;
  profit_krw: string | null;
  return_percent: string | null;
  current_value_krw: string | null;
};

type UsageRow = { id: string; used_on: string; amount_krw: string; memo: string };

/** "Delayed" means more than 5 calendar days since the close or rate date (docs/price-source.md). */
const staleAfterDays = 5;

/**
 * Assets with their value on the reference date ($1: every caller passes it FIRST), filtered by `where` on
 * `a` (portfolio_assets). All in SQL numeric, rounded once at the end (AGENTS.project.md).
 *
 * - Depreciating and prepaid assets: their computed value (migrations 007, 010).
 * - A quantity with a unit price: quantity × price in the asset's currency. The price is the newest close on or
 *   before $1 for a linked security, else the price entered by hand if dated on or before $1. A linked
 *   security without a close has no value at all: no hand price or hand value is mixed in (decision
 *   2026-11-10, #47 review).
 * - An asset whose quantity comes from trades and that holds nothing: 0.
 * - Otherwise the value entered by hand.
 * - USD: converted with the newest USD rate on or before $1, so round(quantity × price × rate) once.
 * - A value over 1,000조 (won or dollars) is not counted, like the values entered by hand are capped.
 *
 * $1 picks the close, rate, hand price and depreciated or prepaid value of that date; the quantity and the
 * trade cost are the current ones (a past quantity comes with the net worth history, #49).
 */
const assetQuery = (where: string) => `
  WITH base AS (
    SELECT a.*,
      (SELECT coalesce(sum(u.amount_krw), 0)::bigint FROM portfolio_prepaid_usages u
        WHERE u.asset_id = a.id AND u.used_on <= $1::date) AS prepaid_used_krw,
      EXISTS (SELECT 1 FROM portfolio_trades tr WHERE tr.asset_id = a.id) AS has_trades,
      s.market AS security_market, s.symbol AS security_symbol, s.name AS security_name,
      s.active AS security_active,
      p.trade_date AS close_date, fx.fx_rate, fx.rate_date AS fx_date, pos.cost_krw_after AS position_cost,
      CASE
        WHEN a.security_id IS NOT NULL THEN p.close
        WHEN a.manual_price_on <= $1::date THEN a.manual_price
      END AS unit_price
    FROM portfolio_assets a
    LEFT JOIN securities s ON s.id = a.security_id
    LEFT JOIN LATERAL (
      SELECT close, trade_date FROM security_prices
      WHERE security_id = a.security_id AND trade_date <= $1::date ORDER BY trade_date DESC LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT fx_rate, rate_date FROM fx_rates
      WHERE currency = 'USD' AND a.currency = 'USD' AND rate_date <= $1::date
      ORDER BY rate_date DESC LIMIT 1
    ) fx ON true
    LEFT JOIN LATERAL (
      SELECT t.cost_krw_after FROM portfolio_trade_positions(a.id) WITH ORDINALITY t
      WHERE a.quantity_from_trades ORDER BY t.ordinality DESC LIMIT 1
    ) pos ON true
    WHERE ${where}
  ), priced AS (
    SELECT base.*,
      CASE
        WHEN quantity IS NOT NULL AND unit_price IS NOT NULL THEN quantity * unit_price
        WHEN quantity IS NULL AND quantity_from_trades THEN 0
        WHEN security_id IS NOT NULL THEN NULL
        WHEN currency = 'KRW' THEN value_krw
        ELSE value_foreign
      END AS local_value
    FROM base
  ), converted AS (
    SELECT priced.*,
      coalesce(
        portfolio_depreciated_value(purchase_price_krw, salvage_value_krw, purchased_on, useful_life_months,
          $1::date),
        portfolio_prepaid_value(prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on,
          prepaid_used_krw, $1::date),
        CASE WHEN currency = 'KRW' THEN local_value ELSE local_value * fx_rate END
      ) AS krw_raw
    FROM priced
  ), valued AS (
    SELECT converted.*,
      CASE WHEN krw_raw <= 1e15 AND coalesce(local_value, 0) <= 1e15 THEN round(krw_raw)::bigint END
        AS value_now
    FROM converted
  )
  SELECT id, name, asset_type, currency, quantity, value_krw, value_foreign, memo,
    purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw,
    prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on, prepaid_used_krw, has_trades,
    security_id, security_market, security_symbol, security_name, security_active,
    manual_price, manual_price_on, unit_price,
    CASE WHEN security_id IS NOT NULL THEN close_date ELSE manual_price_on END AS price_date,
    CASE WHEN security_id IS NOT NULL THEN ($1::date - close_date) > ${staleAfterDays} END AS price_stale,
    fx_rate, fx_date, ($1::date - fx_date) > ${staleAfterDays} AS fx_stale,
    CASE WHEN currency = 'USD' AND local_value <= 1e15 THEN round(local_value, 4) END AS current_value_foreign,
    CASE
      WHEN value_now IS NOT NULL THEN NULL
      WHEN krw_raw > 1e15 OR local_value > 1e15 THEN 'too_large'
      WHEN local_value IS NULL THEN 'no_price'
      ELSE 'no_fx'
    END AS value_issue,
    CASE WHEN has_trades THEN position_cost END AS cost_krw,
    CASE WHEN has_trades AND value_now IS NOT NULL THEN value_now - position_cost END AS profit_krw,
    CASE WHEN has_trades AND value_now IS NOT NULL AND position_cost > 0
      THEN round((value_now - position_cost) * 100.0 / position_cost, 2) END AS return_percent,
    value_now AS current_value_krw
  FROM valued`;

const wonText = new Intl.NumberFormat('ko-KR');

/**
 * Locks an asset row and returns its prepaid fields with the total used so far, or a 404.
 * The sum is a separate statement: under READ COMMITTED a subquery in the locking statement reads the
 * snapshot from before the lock wait and would miss a use committed meanwhile.
 */
async function lockForUses(client: PoolClient, id: number) {
  const found = await client.query<{
    prepaid_kind: string | null;
    prepaid_amount_krw: string | null;
    prepaid_expires_on: string | null;
  }>(
    'SELECT prepaid_kind, prepaid_amount_krw, prepaid_expires_on FROM portfolio_assets WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!found.rows[0]) throw new HttpError(404, '자산을 찾을 수 없습니다');
  const sum = await client.query<{ used: string; last_used_on: string | null }>(
    `SELECT coalesce(sum(amount_krw), 0) AS used, max(used_on) AS last_used_on
     FROM portfolio_prepaid_usages WHERE asset_id = $1`,
    [id],
  );
  return {
    ...found.rows[0],
    used: Number(sum.rows[0].used),
    lastUsedOn: sum.rows[0].last_used_on,
  };
}

// pg returns bigint as a string; won amounts stay exact as long as they are safe integers.
function won(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`won amount out of safe range: ${value}`);
  return parsed;
}

// A total as a JSON number, or null when it no longer fits one exactly.
function total(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const toAsset = (row: Row) => ({
  id: Number(row.id),
  name: row.name,
  type: row.asset_type,
  currency: row.currency,
  quantity: row.quantity,
  valueKrw: row.value_krw === null ? null : won(row.value_krw),
  valueForeign: row.value_foreign,
  memo: row.memo,
  // The DB sets the four together (portfolio_assets_depreciation_check).
  depreciation:
    row.purchase_price_krw === null
      ? null
      : {
          purchasePriceKrw: won(row.purchase_price_krw),
          purchasedOn: row.purchased_on,
          usefulLifeMonths: row.useful_life_months,
          salvageValueKrw: won(row.salvage_value_krw ?? '0'),
        },
  // The DB keeps these consistent (portfolio_assets_prepaid_check). usedKrw counts uses up to the reference date.
  prepaid:
    row.prepaid_kind === null
      ? null
      : {
          kind: row.prepaid_kind,
          amountKrw: won(row.prepaid_amount_krw ?? '0'),
          startsOn: row.prepaid_starts_on,
          expiresOn: row.prepaid_expires_on,
          usedKrw: won(row.prepaid_used_krw),
        },
  // #46 Whether the asset has trades; its quantity is then their total and cannot be entered by hand.
  hasTrades: row.has_trades,
  // #47 The linked security (stocks only), and the price entered by hand for an unlinked asset.
  security:
    row.security_id === null
      ? null
      : {
          id: Number(row.security_id),
          market: row.security_market,
          symbol: row.security_symbol,
          name: row.security_name,
          // false: no longer traded (#97). Valued at its last close.
          active: row.security_active,
        },
  manualPrice:
    row.manual_price === null ? null : { price: row.manual_price, pricedOn: row.manual_price_on },
  // The unit price the value uses: the newest stored close of the linked security, or the hand price.
  price:
    row.unit_price === null
      ? null
      : {
          price: row.unit_price,
          currency: row.currency,
          source: row.security_id === null ? 'manual' : 'close',
          date: row.price_date,
          stale: row.price_stale === true,
        },
  // USD assets: the newest stored USD rate on the reference date, used for the won value.
  fx:
    row.fx_rate === null
      ? null
      : { fxRate: row.fx_rate, rateDate: row.fx_date, stale: row.fx_stale === true },
  // The won value counted in the totals, null when it cannot be counted (valueIssue says why).
  currentValueKrw: row.current_value_krw === null ? null : won(row.current_value_krw),
  // USD assets: the dollar value, shown even without a rate.
  currentValueForeign: row.current_value_foreign,
  valueIssue: row.value_issue,
  // Assets with trades: the won cost still held (buy fees included, #46), the gain against it and its rate (%).
  costKrw: row.cost_krw === null ? null : won(row.cost_krw),
  profitKrw: row.profit_krw === null ? null : won(row.profit_krw),
  returnPercent: row.return_percent,
});

type Options = { today: () => string; now: () => Date; prices: PriceSources; log: PriceLog };

export function assetsRouter(pool: Pool, { today, now, prices, log }: Options) {
  const router = Router();

  const readAsset = async (db: Pool | PoolClient, id: number) =>
    (await db.query<Row>(assetQuery('a.id = $2'), [today(), id])).rows[0];

  // Totals add up current won values (see assetQuery) on `asOf`, by default today in the service time zone.
  // `uncounted` says how many were left out: no price, no USD rate, or too large. Debts are kept apart.
  // #48 `allocation` spreads the asset total by type and by asset (allocation.ts).
  // All come from one snapshot, so the list, the totals and the allocation always agree.
  router.get('/', async (req, res) => {
    const asOf = listQuery.parse(req.query).asOf ?? today();
    const { assets, sums, allocation } = await inTransaction(pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const list = await client.query<Row>(`${assetQuery('true')} ORDER BY asset_type, id`, [asOf]);
      const totals = await client.query<{
        assets: string;
        debts: string;
        net: string;
        uncounted: number;
      }>(
        `SELECT coalesce(sum(current_value_krw) FILTER (WHERE asset_type <> 'debt'), 0) AS assets,
                coalesce(sum(current_value_krw) FILTER (WHERE asset_type = 'debt'), 0) AS debts,
                coalesce(sum(CASE WHEN asset_type = 'debt' THEN -current_value_krw ELSE current_value_krw END), 0)
                  AS net,
                count(*) FILTER (WHERE current_value_krw IS NULL)::int AS uncounted
         FROM (${assetQuery('true')}) valued`,
        [asOf],
      );
      const allocation = await readAllocation(client, assetQuery('true'), asOf);
      return { assets: list.rows, sums: totals.rows[0], allocation };
    });
    res.json({
      asOf,
      assets: assets.map(toAsset),
      totals: {
        assetsKrw: total(sums.assets),
        debtsKrw: total(sums.debts),
        netKrw: total(sums.net),
        uncounted: sums.uncounted,
      },
      allocation: {
        excluded: allocation.excluded,
        byType: allocation.byType.map((row) => ({
          type: row.type,
          amountKrw: total(row.amount_krw),
          share: row.share,
          count: row.count,
        })),
        byAsset: allocation.byAsset.map((row) => ({
          id: Number(row.key),
          name: row.label,
          type: row.type,
          amountKrw: total(row.amount_krw),
          share: row.share,
        })),
        // The 8 largest assets, then key 'rest' for the others together (count says how many).
        chart: allocation.chart.map((row) => ({
          key: row.key,
          name: row.key === 'rest' ? null : row.label,
          amountKrw: total(row.amount_krw),
          share: row.share,
          count: row.count,
        })),
      },
    });
  });

  const values = (body: z.infer<typeof assetBody>) => [
    body.name,
    body.type,
    body.currency,
    body.quantity,
    body.valueKrw,
    body.valueForeign,
    body.memo,
    body.depreciation?.purchasePriceKrw ?? null,
    body.depreciation?.purchasedOn ?? null,
    body.depreciation?.usefulLifeMonths ?? null,
    body.depreciation?.salvageValueKrw ?? null,
    body.prepaid?.kind ?? null,
    body.prepaid?.amountKrw ?? null,
    body.prepaid?.startsOn ?? null,
    body.prepaid?.expiresOn ?? null,
    body.securityId,
    body.manualPrice?.price ?? null,
    body.manualPrice?.pricedOn ?? null,
  ];

  /**
   * A linked security must exist and be in the asset's currency (decision 2026-11-10: the currency follows the
   * security; the form sets it). Returns the security, for the fetch below.
   */
  const checkSecurity = async (db: Pool | PoolClient, body: z.infer<typeof assetBody>) => {
    if (body.securityId === null) return null;
    const { rows } = await db.query<{
      id: string;
      symbol: string;
      name: string | null;
      currency: string;
    }>('SELECT id, symbol, name, currency FROM securities WHERE id = $1', [body.securityId]);
    const security = rows[0];
    if (!security) throw new HttpError(400, '연결할 종목을 찾을 수 없습니다');
    if (security.currency !== body.currency) {
      throw new HttpError(400, `종목의 통화(${security.currency})와 자산의 통화가 같아야 합니다`);
    }
    return {
      id: Number(security.id),
      symbol: security.symbol,
      name: security.name,
      currency: security.currency,
    };
  };

  /**
   * A US security linked without any stored close is fetched once right away (decision 2026-11-10), within the
   * same hourly limit as opening its detail. From then on the daily fetch covers it while the asset holds it.
   * Best effort: a failure leaves the asset without a price ("시세 없음") and is logged.
   */
  const fetchIfMissing = async (security: Awaited<ReturnType<typeof checkSecurity>>) => {
    if (!security || security.currency !== 'USD' || !prices.tiingo) return;
    try {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM security_prices WHERE security_id = $1 LIMIT 1',
        [security.id],
      );
      if (rowCount) return;
      const result = await fetchUsCloses(pool, prices.tiingo, security, now(), tiingoHourlyLimit);
      if (result !== 'saved' && result !== 'up_to_date') {
        log({ event: 'price_fetch_now', symbol: security.symbol, result });
      }
    } catch {
      // The asset is already saved: a failed fetch must not become a 500 that invites saving it twice.
      log({ event: 'price_fetch_now', symbol: security.symbol, result: 'error' });
    }
  };

  router.post('/', async (req, res) => {
    const body = assetBody.parse(req.body);
    requireQuantityOrValue(body);
    const security = await checkSecurity(pool, body);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO portfolio_assets (name, asset_type, currency, quantity, value_krw, value_foreign, memo,
         purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw,
         prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on,
         security_id, manual_price, manual_price_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
      values(body),
    );
    const id = Number(rows[0].id);
    await fetchIfMissing(security);
    res.status(201).json({ asset: toAsset(await readAsset(pool, id)) });
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const body = assetBody.parse(req.body);
    const security = await inTransaction(pool, async (client) => {
      // Locked so a use cannot be added between the check and the update.
      const { used, lastUsedOn } = await lockForUses(client, id);
      if (used > 0) {
        if (body.prepaid?.kind !== 'amount') {
          throw new HttpError(
            400,
            '사용 기록이 있는 금액권은 금액권으로만 바꿀 수 있습니다. 사용 기록을 먼저 지우세요',
          );
        }
        if (body.prepaid.amountKrw < used) {
          throw new HttpError(
            400,
            `결제액은 이미 쓴 금액(${wonText.format(used)}원)보다 적을 수 없습니다`,
          );
        }
        // Keeps the rule a new use follows: no use after the expiry date.
        const { expiresOn } = body.prepaid;
        if (expiresOn !== null && lastUsedOn !== null && expiresOn < lastUsedOn) {
          throw new HttpError(400, `만료일은 마지막 사용일(${lastUsedOn})보다 앞설 수 없습니다`);
        }
      }
      // #46 An asset with trades keeps a tradeable type and its currency, and its quantity is the trades'
      // total (the row is already locked, as trade writes lock it too). Without trades it is entered by hand.
      const traded = await client.query<{
        currency: string;
        trades: number;
        same_quantity: boolean;
      }>(
        `SELECT currency, (SELECT count(*) FROM portfolio_trades WHERE asset_id = $1)::int AS trades,
                $2::numeric IS NOT DISTINCT FROM quantity AS same_quantity
         FROM portfolio_assets WHERE id = $1`,
        [id, body.quantity],
      );
      const { currency, trades, same_quantity } = traded.rows[0];
      if (trades > 0) {
        if (!tradeableTypes.includes(body.type) || body.currency !== currency) {
          throw new HttpError(
            400,
            '거래 기록이 있는 자산은 주식이나 기타(코인 등)로, 같은 통화로만 바꿀 수 있습니다',
          );
        }
        if (!same_quantity) {
          throw new HttpError(400, '거래 기록이 있는 자산의 수량은 거래로만 바뀝니다');
        }
      } else {
        requireQuantityOrValue(body);
      }
      const linked = await checkSecurity(client, body);
      await client.query(
        `UPDATE portfolio_assets
         SET name = $1, asset_type = $2, currency = $3, quantity = $4, value_krw = $5, value_foreign = $6,
             memo = $7, purchase_price_krw = $8, purchased_on = $9, useful_life_months = $10,
             salvage_value_krw = $11, prepaid_kind = $12, prepaid_amount_krw = $13, prepaid_starts_on = $14,
             prepaid_expires_on = $15, security_id = $16, manual_price = $17, manual_price_on = $18,
             quantity_from_trades = $20, updated_at = now()
         WHERE id = $19`,
        [...values(body), id, trades > 0],
      );
      return linked;
    });
    await fetchIfMissing(security);
    res.json({ asset: toAsset(await readAsset(pool, id)) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const { rowCount } = await pool.query('DELETE FROM portfolio_assets WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, '자산을 찾을 수 없습니다');
    res.status(204).end();
  });

  // #64 Uses of a stored-value prepaid asset: listed, added and deleted (no editing, decision 2026-11-08).
  const toUsage = (row: UsageRow) => ({
    id: Number(row.id),
    usedOn: row.used_on,
    amountKrw: won(row.amount_krw),
    memo: row.memo,
  });

  router.get('/:id/usages', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const asset = await pool.query('SELECT 1 FROM portfolio_assets WHERE id = $1', [id]);
    if (!asset.rowCount) throw new HttpError(404, '자산을 찾을 수 없습니다');
    const { rows } = await pool.query<UsageRow>(
      `SELECT id, used_on, amount_krw, memo FROM portfolio_prepaid_usages
       WHERE asset_id = $1 ORDER BY used_on DESC, id DESC`,
      [id],
    );
    res.json({ usages: rows.map(toUsage) });
  });

  router.post('/:id/usages', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const body = usageBody.parse(req.body);
    const usage = await inTransaction(pool, async (client) => {
      // Locked so two uses at once cannot both pass the balance check.
      const asset = await lockForUses(client, id);
      if (asset.prepaid_kind !== 'amount') {
        throw new HttpError(400, '사용 기록은 선입금 금액권에만 넣을 수 있습니다');
      }
      // A use is something that happened: a later date would count in the balance but not yet in the value.
      if (body.usedOn > today()) {
        throw new HttpError(400, '오늘 이후 날짜에는 사용을 기록할 수 없습니다');
      }
      if (asset.prepaid_expires_on !== null && body.usedOn > asset.prepaid_expires_on) {
        throw new HttpError(
          400,
          `만료일(${asset.prepaid_expires_on})이 지난 날짜에는 쓸 수 없습니다`,
        );
      }
      const left = Number(asset.prepaid_amount_krw) - asset.used;
      if (body.amountKrw > left) {
        throw new HttpError(
          400,
          `잔액보다 많이 쓸 수 없습니다(남은 금액 ${wonText.format(left)}원)`,
        );
      }
      const { rows } = await client.query<UsageRow>(
        `INSERT INTO portfolio_prepaid_usages (asset_id, used_on, amount_krw, memo)
         VALUES ($1, $2, $3, $4) RETURNING id, used_on, amount_krw, memo`,
        [id, body.usedOn, body.amountKrw, body.memo],
      );
      return rows[0];
    });
    res.status(201).json({ usage: toUsage(usage) });
  });

  router.delete('/:id/usages/:usageId', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const usageId = parseId(req.params.usageId, '사용 기록');
    const { rowCount } = await pool.query(
      'DELETE FROM portfolio_prepaid_usages WHERE id = $1 AND asset_id = $2',
      [usageId, id],
    );
    if (!rowCount) throw new HttpError(404, '사용 기록을 찾을 수 없습니다');
    res.status(204).end();
  });

  // #46 Buy and sell records: /api/portfolio/assets/:id/trades.
  router.use('/:id/trades', tradesRouter(pool, today));

  return router;
}
