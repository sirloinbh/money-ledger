import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from './standard/http.js';

// #45 Held assets and debts. Formats follow AGENTS.project.md "수량·외화·환율" (#35):
// won amounts are JSON numbers (bigint in the DB), quantities and USD amounts are decimal strings.
// Trades and average prices come with #46, prices and FX conversion with #47.

const maxWon = 1_000_000_000_000_000;

const assetTypes = ['stock', 'real_estate', 'cash', 'debt', 'depreciable', 'other'] as const;

// Up to 12 integer and 8 fractional digits: numeric(20,8).
const quantityPattern = /^\d{1,12}(\.\d{1,8})?$/;
// Up to 16 integer and 4 fractional digits: numeric(20,4).
const foreignPattern = /^\d{1,16}(\.\d{1,4})?$/;

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
    if (body.quantity === null && body.valueKrw === null && body.valueForeign === null) {
      issue('수량이 없는 자산은 평가금액을 입력하세요');
    }
    if (body.type === 'debt' && body.quantity !== null) {
      issue('부채에는 수량을 넣을 수 없습니다');
    }
  });

type Row = {
  id: string;
  name: string;
  asset_type: (typeof assetTypes)[number];
  currency: 'KRW' | 'USD';
  quantity: string | null;
  value_krw: string | null;
  value_foreign: string | null;
  memo: string;
};

const columns = 'id, name, asset_type, currency, quantity, value_krw, value_foreign, memo';

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
});

export function assetsRouter(pool: Pool) {
  const router = Router();

  // Totals count only won values entered by hand. USD values wait for FX (#47), and assets with a quantity
  // but no value wait for prices (#47); `uncounted` says how many were left out. Debts are kept apart.
  router.get('/', async (_req, res) => {
    const [assets, totals] = await Promise.all([
      pool.query<Row>(`SELECT ${columns} FROM portfolio_assets ORDER BY asset_type, id`),
      pool.query<{ assets: string; debts: string; net: string; uncounted: number }>(
        `SELECT coalesce(sum(value_krw) FILTER (WHERE asset_type <> 'debt'), 0) AS assets,
                coalesce(sum(value_krw) FILTER (WHERE asset_type = 'debt'), 0) AS debts,
                coalesce(sum(CASE WHEN asset_type = 'debt' THEN -value_krw ELSE value_krw END), 0) AS net,
                count(*) FILTER (WHERE value_krw IS NULL)::int AS uncounted
         FROM portfolio_assets`,
      ),
    ]);
    const sums = totals.rows[0];
    res.json({
      assets: assets.rows.map(toAsset),
      totals: {
        assetsKrw: total(sums.assets),
        debtsKrw: total(sums.debts),
        netKrw: total(sums.net),
        uncounted: sums.uncounted,
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
  ];

  router.post('/', async (req, res) => {
    const body = assetBody.parse(req.body);
    const { rows } = await pool.query<Row>(
      `INSERT INTO portfolio_assets (name, asset_type, currency, quantity, value_krw, value_foreign, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${columns}`,
      values(body),
    );
    res.status(201).json({ asset: toAsset(rows[0]) });
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const body = assetBody.parse(req.body);
    const { rows } = await pool.query<Row>(
      `UPDATE portfolio_assets
       SET name = $2, asset_type = $3, currency = $4, quantity = $5, value_krw = $6, value_foreign = $7,
           memo = $8, updated_at = now()
       WHERE id = $1 RETURNING ${columns}`,
      [id, ...values(body)],
    );
    if (!rows[0]) throw new HttpError(404, '자산을 찾을 수 없습니다');
    res.json({ asset: toAsset(rows[0]) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, '자산');
    const { rowCount } = await pool.query('DELETE FROM portfolio_assets WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, '자산을 찾을 수 없습니다');
    res.status(204).end();
  });

  return router;
}
