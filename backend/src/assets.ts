import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from './db.js';
import { date } from './entries.js';
import { HttpError, parseId } from './standard/http.js';

// #45 Held assets and debts. Formats follow AGENTS.project.md "수량·외화·환율" (#35):
// won amounts are JSON numbers (bigint in the DB), quantities and USD amounts are decimal strings.
// Trades and average prices come with #46, prices and FX conversion with #47.
// #63 A depreciating asset stores its purchase price, date, useful life and salvage value instead of a value;
// the server works out its current value for a reference date (straight-line by month, migration 007).
// #64 A prepaid asset (hair salon, gym) is a stored-value 'amount' with uses, or a 'period' pass; its value
// comes from what was paid (migration 010). Paying is a ledger expense, so using it is not one again.

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

// Korean particles depend on whether the label ends in a final consonant: 구입가는 / 결제액은.
function particles(label: string) {
  const last = label.charCodeAt(label.length - 1) - 0xac00;
  const final = last >= 0 && last < 11172 && last % 28 !== 0;
  return final ? { topic: '은', object: '을' } : { topic: '는', object: '를' };
}

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
    if (body.quantity === null && body.valueKrw === null && body.valueForeign === null) {
      issue('수량이 없는 자산은 평가금액을 입력하세요');
    }
    if (body.type === 'debt' && body.quantity !== null) {
      issue('부채에는 수량을 넣을 수 없습니다');
    }
  });

const listQuery = z.object({ asOf: date.optional() });

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
  current_value_krw: string | null;
};

type UsageRow = { id: string; used_on: string; amount_krw: string; memo: string };

// Uses of a stored-value prepaid asset up to the reference date ($1).
const usedUpTo = `(SELECT coalesce(sum(u.amount_krw), 0)::bigint FROM portfolio_prepaid_usages u
  WHERE u.asset_id = portfolio_assets.id AND u.used_on <= $1::date)`;

// The won value counted in the totals on the reference date ($1): a depreciating or prepaid asset's
// computed value, otherwise the value entered by hand (null for USD values and quantity-only assets).
// Every query that uses `currentValue` or `columns` must pass the reference date as its FIRST parameter.
const currentValue = `coalesce(
  portfolio_depreciated_value(purchase_price_krw, salvage_value_krw, purchased_on, useful_life_months, $1::date),
  portfolio_prepaid_value(prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on,
    ${usedUpTo}, $1::date),
  value_krw)`;

const columns = `id, name, asset_type, currency, quantity, value_krw, value_foreign, memo,
  purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw,
  prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on, ${usedUpTo} AS prepaid_used_krw,
  ${currentValue} AS current_value_krw`;

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
  const sum = await client.query<{ used: string }>(
    'SELECT coalesce(sum(amount_krw), 0) AS used FROM portfolio_prepaid_usages WHERE asset_id = $1',
    [id],
  );
  return { ...found.rows[0], used: Number(sum.rows[0].used) };
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
  currentValueKrw: row.current_value_krw === null ? null : won(row.current_value_krw),
});

export function assetsRouter(pool: Pool, today: () => string) {
  const router = Router();

  // Totals add up current won values (see currentValue) on `asOf`, by default today in the service time
  // zone. USD values wait for FX (#47) and assets with a quantity but no value wait for prices (#47);
  // `uncounted` says how many were left out. Debts are kept apart.
  router.get('/', async (req, res) => {
    const asOf = listQuery.parse(req.query).asOf ?? today();
    const [assets, totals] = await Promise.all([
      pool.query<Row>(`SELECT ${columns} FROM portfolio_assets ORDER BY asset_type, id`, [asOf]),
      pool.query<{ assets: string; debts: string; net: string; uncounted: number }>(
        `WITH valued AS (SELECT asset_type, ${currentValue} AS value FROM portfolio_assets)
         SELECT coalesce(sum(value) FILTER (WHERE asset_type <> 'debt'), 0) AS assets,
                coalesce(sum(value) FILTER (WHERE asset_type = 'debt'), 0) AS debts,
                coalesce(sum(CASE WHEN asset_type = 'debt' THEN -value ELSE value END), 0) AS net,
                count(*) FILTER (WHERE value IS NULL)::int AS uncounted
         FROM valued`,
        [asOf],
      ),
    ]);
    const sums = totals.rows[0];
    res.json({
      asOf,
      assets: assets.rows.map(toAsset),
      totals: {
        assetsKrw: total(sums.assets),
        debtsKrw: total(sums.debts),
        netKrw: total(sums.net),
        uncounted: sums.uncounted,
      },
    });
  });

  // $1 is the reference date for current_value_krw in RETURNING: today.
  const values = (body: z.infer<typeof assetBody>) => [
    today(),
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
  ];

  router.post('/', async (req, res) => {
    const body = assetBody.parse(req.body);
    const { rows } = await pool.query<Row>(
      `INSERT INTO portfolio_assets (name, asset_type, currency, quantity, value_krw, value_foreign, memo,
         purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw,
         prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on)
       VALUES ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING ${columns}`,
      values(body),
    );
    res.status(201).json({ asset: toAsset(rows[0]) });
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const body = assetBody.parse(req.body);
    const asset = await inTransaction(pool, async (client) => {
      // Locked so a use cannot be added between the check and the update.
      const { used } = await lockForUses(client, id);
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
      }
      const { rows } = await client.query<Row>(
        `UPDATE portfolio_assets
         SET name = $2, asset_type = $3, currency = $4, quantity = $5, value_krw = $6, value_foreign = $7,
             memo = $8, purchase_price_krw = $9, purchased_on = $10, useful_life_months = $11,
             salvage_value_krw = $12, prepaid_kind = $13, prepaid_amount_krw = $14, prepaid_starts_on = $15,
             prepaid_expires_on = $16, updated_at = now()
         WHERE id = $17 RETURNING ${columns}`,
        [...values(body), id],
      );
      return rows[0];
    });
    res.json({ asset: toAsset(asset) });
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

  return router;
}
