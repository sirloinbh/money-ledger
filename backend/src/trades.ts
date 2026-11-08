import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from './db.js';
import { date } from './entries.js';
import { particles } from './korean.js';
import { HttpError, parseId } from './standard/http.js';

// #46 Buy and sell records of a held asset. The position (quantity, moving-average cost, realized profit)
// is worked out in one place, the SQL function portfolio_trade_positions (migration 013), in numeric.
// Decisions (2026-11-08): moving average; fees and taxes in won per trade (a buy's into the cost, a sell's
// off the realized profit); a USD asset's average price in dollars and its realized profit in won with the
// trade's entered rate; only stock and other assets; the asset's quantity is the trades' total; a change
// that leaves the quantity negative at any point in date order is refused; same-date trades in entry order.
// Mounted at /api/portfolio/assets/:id/trades.

const maxWon = 1_000_000_000_000_000;
const tradeableTypes = ['stock', 'other'];

const wonCost = (label: string) => {
  const { topic, object } = particles(label);
  return z
    .number({ error: `${label}${object} 숫자로 입력하세요` })
    .int(`${label}${topic} 원 단위 정수로 입력하세요`)
    .min(0, `${label}${topic} 0원 이상이어야 합니다`)
    .max(maxWon, `${label}${topic} 1,000조 원 이하로 입력하세요`)
    .default(0);
};

const tradeBody = z.object(
  {
    side: z.enum(['buy', 'sell'], { error: '매수 또는 매도를 고르세요' }),
    tradedOn: date,
    // numeric(20,8)
    quantity: z
      .string({ error: '수량은 소수 문자열로 보내세요' })
      .regex(/^\d{1,12}(\.\d{1,8})?$/, {
        error: '수량은 정수 12자리, 소수 8자리까지 입력하세요',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), '수량은 0보다 커야 합니다'),
    // numeric(20,4)
    price: z
      .string({ error: '단가는 소수 문자열로 보내세요' })
      .regex(/^\d{1,16}(\.\d{1,4})?$/, {
        error: '단가는 정수 16자리, 소수 4자리까지 입력하세요',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), '단가는 0보다 커야 합니다'),
    // numeric(12,4), won per dollar
    fxRate: z
      .string({ error: '환율은 소수 문자열로 보내세요' })
      .regex(/^\d{1,8}(\.\d{1,4})?$/, {
        error: '환율은 정수 8자리, 소수 4자리까지 입력하세요',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), '환율은 0보다 커야 합니다')
      .nullable()
      .default(null),
    feeKrw: wonCost('수수료'),
    taxKrw: wonCost('세금'),
    memo: z
      .string({ error: '메모는 글자로 입력하세요' })
      .trim()
      .max(100, '메모는 100자 이하로 입력하세요')
      .default(''),
  },
  { error: '요청 본문은 JSON 객체여야 합니다' },
);
type TradeBody = z.infer<typeof tradeBody>;

type TradeRow = {
  id: string;
  side: 'buy' | 'sell';
  traded_on: string;
  quantity: string;
  currency: 'KRW' | 'USD';
  price: string;
  fx_rate: string | null;
  amount_krw: string;
  fee_krw: string;
  tax_krw: string;
  memo: string;
  quantity_after: string;
  realized_krw: string | null;
};

type PositionRow = {
  quantity: string | null;
  average_price: string | null;
  cost_krw: string;
  realized_krw: string;
};

function won(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`won amount out of safe range: ${value}`);
  return parsed;
}

const toTrade = (row: TradeRow) => ({
  id: Number(row.id),
  side: row.side,
  tradedOn: row.traded_on,
  quantity: row.quantity,
  currency: row.currency,
  price: row.price,
  fxRate: row.fx_rate,
  amountKrw: won(row.amount_krw),
  feeKrw: won(row.fee_krw),
  taxKrw: won(row.tax_krw),
  memo: row.memo,
  // What is held after this trade, and for a sell the realized profit in won.
  quantityAfter: row.quantity_after,
  realizedKrw: row.realized_krw === null ? null : won(row.realized_krw),
});

/** The quantity held and its moving-average price in the asset's currency (USD: without the won fees). */
async function position(db: PoolClient, assetId: number, currency: 'KRW' | 'USD') {
  const { rows } = await db.query<PositionRow>(
    `WITH p AS (
       SELECT * FROM portfolio_trade_positions($1) WITH ORDINALITY AS p(trade_id, quantity_after, cost_krw_after, cost_foreign_after, realized_krw, oversold, n)
     ), last AS (SELECT * FROM p ORDER BY n DESC LIMIT 1)
     SELECT
       (SELECT nullif(quantity_after, 0)::numeric(20, 8)::text FROM last) AS quantity,
       (SELECT CASE WHEN quantity_after = 0 THEN NULL
                    WHEN $2 = 'KRW' THEN round(cost_krw_after / quantity_after, 4)
                    ELSE round(cost_foreign_after / quantity_after, 4) END::text FROM last) AS average_price,
       coalesce((SELECT cost_krw_after FROM last), 0)::text AS cost_krw,
       coalesce((SELECT sum(realized_krw) FROM p), 0)::text AS realized_krw`,
    [assetId, currency],
  );
  const row = rows[0];
  return {
    quantity: row.quantity,
    averagePrice: row.average_price,
    costKrw: won(row.cost_krw),
    realizedKrw: won(row.realized_krw),
  };
}

/** Locks the asset and returns its currency, or the 404 / 400 for an asset that cannot have trades. */
async function lockTradeable(client: PoolClient, assetId: number) {
  const { rows } = await client.query<{ asset_type: string; currency: 'KRW' | 'USD' }>(
    'SELECT asset_type, currency FROM portfolio_assets WHERE id = $1 FOR UPDATE',
    [assetId],
  );
  if (!rows[0]) throw new HttpError(404, '자산을 찾을 수 없습니다');
  if (!tradeableTypes.includes(rows[0].asset_type)) {
    throw new HttpError(400, '거래는 주식과 기타(코인 등) 자산에만 기록할 수 있습니다');
  }
  return rows[0].currency;
}

/** Checks a trade against its asset's currency and works out its won amount in numeric, or a 400. */
async function amountFor(client: PoolClient, body: TradeBody, currency: 'KRW' | 'USD') {
  if (currency === 'KRW') {
    if (body.fxRate !== null) throw new HttpError(400, '원화 자산의 거래에는 환율을 넣지 않습니다');
    if (body.price.includes('.') && /[1-9]/.test(body.price.split('.')[1])) {
      throw new HttpError(400, '원화 단가는 원 단위 정수로 입력하세요');
    }
  } else if (body.fxRate === null) {
    throw new HttpError(400, '달러 거래는 그날 환율을 입력하세요');
  }
  // Compared in numeric: the product can be far beyond what a JS number holds exactly.
  const { rows } = await client.query<{ amount: string; too_big: boolean }>(
    `SELECT a::text AS amount, a > $4::numeric AS too_big
     FROM (SELECT round($1::numeric * $2::numeric * coalesce($3::numeric, 1)) AS a) x`,
    [body.quantity, body.price, body.fxRate, maxWon],
  );
  if (rows[0].too_big) throw new HttpError(400, '거래 금액이 1,000조 원을 넘습니다');
  return rows[0].amount;
}

/**
 * Replays the asset's trades in date order and refuses the change (rolling it back) if a sell is ever
 * larger than what is held; otherwise sets the asset's quantity to the trades' total.
 */
async function settle(client: PoolClient, assetId: number) {
  // One replay: the first oversold sell if any, the final quantity, and whether anything along the way
  // is beyond what the columns and JSON numbers hold (numeric(20,8) quantities, safe-integer won).
  const { rows } = await client.query<{
    oversold_on: string | null;
    oversold_held: string | null;
    quantity: string | null;
    too_big: boolean;
  }>(
    `WITH p AS (
       SELECT * FROM portfolio_trade_positions($1)
         WITH ORDINALITY AS p(trade_id, quantity_after, cost_krw_after, cost_foreign_after, realized_krw,
                              oversold, n)
     ), bad AS (
       SELECT t.traded_on, (p.quantity_after + t.quantity) AS held
       FROM p JOIN portfolio_trades t ON t.id = p.trade_id WHERE p.oversold
     )
     SELECT (SELECT traded_on FROM bad) AS oversold_on,
            (SELECT held::numeric(20, 8)::text FROM bad) AS oversold_held,
            (SELECT nullif(quantity_after, 0)::text FROM p ORDER BY n DESC LIMIT 1) AS quantity,
            coalesce((SELECT max(quantity_after) >= 1000000000000
                        OR max(cost_krw_after) > $2::numeric
                        OR abs(sum(realized_krw)) > $2::numeric
                      FROM p WHERE NOT oversold), false) AS too_big`,
    [assetId, Number.MAX_SAFE_INTEGER],
  );
  const result = rows[0];
  if (result.oversold_on !== null) {
    throw new HttpError(
      400,
      `${result.oversold_on} 매도 수량이 그때 보유 수량(${trimDecimal(result.oversold_held ?? '0')})보다 많습니다`,
    );
  }
  if (result.too_big) throw new HttpError(400, '보유 수량이나 금액이 너무 큽니다');
  // Stays trade-managed with no trades left (see migration 013); nothing held is a NULL quantity.
  await client.query(
    `UPDATE portfolio_assets
     SET quantity = $2::numeric, quantity_from_trades = true, updated_at = now()
     WHERE id = $1`,
    [assetId, result.quantity],
  );
}

/** "12.50000000" → "12.5" for messages. */
function trimDecimal(text: string) {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

const tradeColumns = `t.id, t.side, t.traded_on, t.quantity::text, t.currency, t.price::text,
  t.fx_rate::text, t.amount_krw, t.fee_krw, t.tax_krw, t.memo,
  p.quantity_after::numeric(20, 8)::text AS quantity_after, p.realized_krw`;

export function tradesRouter(pool: Pool, today: () => string) {
  const router = Router({ mergeParams: true });
  const assetIdOf = (params: Record<string, string>) => parseId(params.id, '자산');

  router.get('/', async (req, res) => {
    const assetId = assetIdOf(req.params);
    // One snapshot, so the list and the position agree even while a trade is being saved.
    const result = await inTransaction(pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const asset = await client.query<{ currency: 'KRW' | 'USD' }>(
        'SELECT currency FROM portfolio_assets WHERE id = $1',
        [assetId],
      );
      if (!asset.rows[0]) throw new HttpError(404, '자산을 찾을 수 없습니다');
      const trades = await client.query<TradeRow>(
        `SELECT ${tradeColumns}
         FROM portfolio_trades t JOIN portfolio_trade_positions($1) p ON p.trade_id = t.id
         ORDER BY t.traded_on DESC, t.id DESC`,
        [assetId],
      );
      return {
        trades: trades.rows.map(toTrade),
        position: await position(client, assetId, asset.rows[0].currency),
      };
    });
    res.json(result);
  });

  // A trade is something that happened: a date after today is refused.
  const parse = (raw: unknown) => {
    const body = tradeBody.parse(raw);
    if (body.tradedOn > today()) {
      throw new HttpError(400, '오늘 이후 날짜의 거래는 기록할 수 없습니다');
    }
    return body;
  };

  const tradeResponse = async (client: PoolClient, assetId: number, tradeId: number) => {
    const { rows } = await client.query<TradeRow>(
      `SELECT ${tradeColumns}
       FROM portfolio_trades t JOIN portfolio_trade_positions($1) p ON p.trade_id = t.id
       WHERE t.id = $2`,
      [assetId, tradeId],
    );
    return toTrade(rows[0]);
  };

  router.post('/', async (req, res) => {
    const assetId = assetIdOf(req.params);
    const body = parse(req.body);
    const trade = await inTransaction(pool, async (client) => {
      const currency = await lockTradeable(client, assetId);
      const amount = await amountFor(client, body, currency);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO portfolio_trades (asset_id, side, traded_on, quantity, currency, price, fx_rate,
           amount_krw, fee_krw, tax_krw, memo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          assetId,
          body.side,
          body.tradedOn,
          body.quantity,
          currency,
          body.price,
          body.fxRate,
          amount,
          body.feeKrw,
          body.taxKrw,
          body.memo,
        ],
      );
      await settle(client, assetId);
      return tradeResponse(client, assetId, Number(rows[0].id));
    });
    res.status(201).json({ trade });
  });

  router.put('/:tradeId', async (req, res) => {
    const assetId = assetIdOf(req.params);
    const tradeId = parseId(req.params.tradeId, '거래');
    const body = parse(req.body);
    const trade = await inTransaction(pool, async (client) => {
      const currency = await lockTradeable(client, assetId);
      const amount = await amountFor(client, body, currency);
      const { rowCount } = await client.query(
        `UPDATE portfolio_trades
         SET side = $3, traded_on = $4, quantity = $5, price = $6, fx_rate = $7, amount_krw = $8,
             fee_krw = $9, tax_krw = $10, memo = $11, updated_at = now()
         WHERE id = $2 AND asset_id = $1`,
        [
          assetId,
          tradeId,
          body.side,
          body.tradedOn,
          body.quantity,
          body.price,
          body.fxRate,
          amount,
          body.feeKrw,
          body.taxKrw,
          body.memo,
        ],
      );
      if (!rowCount) throw new HttpError(404, '거래를 찾을 수 없습니다');
      await settle(client, assetId);
      return tradeResponse(client, assetId, tradeId);
    });
    res.json({ trade });
  });

  router.delete('/:tradeId', async (req, res) => {
    const assetId = assetIdOf(req.params);
    const tradeId = parseId(req.params.tradeId, '거래');
    await inTransaction(pool, async (client) => {
      await lockTradeable(client, assetId);
      const { rowCount } = await client.query(
        'DELETE FROM portfolio_trades WHERE id = $2 AND asset_id = $1',
        [assetId, tradeId],
      );
      if (!rowCount) throw new HttpError(404, '거래를 찾을 수 없습니다');
      // Deleting a buy that a later sell relies on is refused too.
      await settle(client, assetId);
    });
    res.status(204).end();
  });

  return router;
}
