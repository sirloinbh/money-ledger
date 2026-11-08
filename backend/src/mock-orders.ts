import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from './db.js';
import { HttpError, parseId } from './standard/http.js';

// #52 Mock trading market orders (decisions 2026-11-08, issue comment):
// - One won cash balance. A US order is converted with the latest stored USD deal base rate at order time:
//   amount_krw = round(quantity × price × fx_rate), all in SQL numeric (AGENTS.project.md).
// - The fill price is the latest stored close on the server (docs/price-source.md), never a client value.
//   Orders fill at once whatever the time of day, and the screen says which day's close was used.
// - Fee = round(amount_krw × the account's fee rate), 0 by default. No taxes.
// - Whole shares only. Inactive securities (#97) cannot be bought; they can be sold.
// - A request key from the screen makes a repeated request return the first order instead of a second fill.

const maxQuantity = 1_000_000;
const maxWon = 1_000_000_000_000_000n; // the CHECK ceiling of cash and amounts in 015

const quantityField = z
  .string({ error: '수량을 입력하세요' })
  .regex(/^[1-9]\d{0,6}$/, '수량은 1주 단위의 정수로 입력하세요')
  .refine((text) => Number(text) <= maxQuantity, '수량은 1,000,000주 이하로 입력하세요');
const sideField = z.enum(['buy', 'sell'], { error: '매수 또는 매도를 고르세요' });
const securityField = z
  .string({ error: '종목을 고르세요' })
  .regex(/^[1-9]\d{0,14}$/, '종목 ID가 올바르지 않습니다');

const orderBody = z.object(
  {
    securityId: z
      .number({ error: '종목을 고르세요' })
      .int('종목 ID가 올바르지 않습니다')
      .positive('종목 ID가 올바르지 않습니다'),
    side: sideField,
    quantity: quantityField,
    requestKey: z.uuid({ error: '주문 키가 올바르지 않습니다' }),
    // What the confirmation showed. The fill still uses the server's latest close and rate; these are only
    // compared with them, so an order never fills at a price the person did not see (#52 review).
    expectedPrice: z
      .string({ error: '확인한 시세가 없습니다. 주문을 다시 확인하세요' })
      .max(30, '확인한 시세가 올바르지 않습니다')
      .nullable(),
    expectedPriceDate: z
      .string({ error: '확인한 시세가 없습니다. 주문을 다시 확인하세요' })
      .max(10, '확인한 시세가 올바르지 않습니다')
      .nullable(),
    expectedFxRate: z
      .string({ error: '확인한 시세가 없습니다. 주문을 다시 확인하세요' })
      .max(30, '확인한 시세가 올바르지 않습니다')
      .nullable(),
  },
  { error: '요청 본문은 JSON 객체여야 합니다' },
);

const previewQuery = z.object({
  securityId: securityField,
  side: sideField,
  quantity: quantityField,
});

type Side = 'buy' | 'sell';
type Db = Pool | PoolClient;
type Account = { id: string; cash_krw: string; fee_rate: string; closed_at: Date | null };

type QuoteRow = {
  id: string;
  symbol: string;
  name: string | null;
  currency: 'KRW' | 'USD';
  active: boolean;
  close: string | null;
  trade_date: string | null;
  fx_rate: string | null;
  rate_date: string | null;
  amount_krw: string | null;
  fee_krw: string | null;
  held: string | null;
  held_cost: string | null;
  stale: boolean | null;
};

/** The latest close (and rate for USD), the won amounts for `quantity`, and what the account holds. */
async function quote(
  db: Db,
  account: Account,
  securityId: number,
  quantity: string,
  today: string,
): Promise<QuoteRow> {
  const { rows } = await db.query<QuoteRow>(
    `SELECT s.id, s.symbol, s.name, s.currency, s.active, p.close, p.trade_date, fx.fx_rate, fx.rate_date,
            ($5::date - p.trade_date) > 5 AS stale, h.quantity AS held, h.cost_krw AS held_cost,
            amount.krw AS amount_krw,
            round(amount.krw * $4::numeric) AS fee_krw
     FROM securities s
     LEFT JOIN LATERAL (
       SELECT close, trade_date FROM security_prices WHERE security_id = s.id
       ORDER BY trade_date DESC LIMIT 1
     ) p ON true
     LEFT JOIN LATERAL (
       SELECT fx_rate, rate_date FROM fx_rates WHERE currency = 'USD' AND s.currency = 'USD'
       ORDER BY rate_date DESC LIMIT 1
     ) fx ON true
     LEFT JOIN mock_holdings h ON h.account_id = $3 AND h.security_id = s.id
     CROSS JOIN LATERAL (
       SELECT CASE WHEN p.close IS NULL OR (s.currency = 'USD' AND fx.fx_rate IS NULL) THEN NULL
                   ELSE round($2::numeric * p.close * coalesce(fx.fx_rate, 1)) END AS krw
     ) amount
     WHERE s.id = $1`,
    [securityId, quantity, account.id, account.fee_rate, today],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, '종목을 찾을 수 없습니다');
  return row;
}

/** The Korean reason the order cannot fill, or null. The same checks run for the preview and the order. */
function problemOf(account: Account, row: QuoteRow, side: Side, quantity: string) {
  if (side === 'buy' && !row.active) return '거래가 중단된 종목은 살 수 없습니다';
  if (row.close === null) return '저장된 종가가 없어 주문할 수 없습니다';
  if (row.currency === 'USD' && row.fx_rate === null) {
    return '저장된 환율이 없어 미국 주식을 주문할 수 없습니다';
  }
  const amount = BigInt(row.amount_krw!);
  const fee = BigInt(row.fee_krw!);
  const cash = BigInt(account.cash_krw);
  if (amount > maxWon) return '주문 금액이 너무 큽니다';
  if (side === 'buy' && amount + fee > cash) return '현금이 부족합니다';
  // The cost of a holding has the same 1,000조 ceiling as cash (015).
  if (side === 'buy' && BigInt(row.held_cost ?? '0') + amount + fee > maxWon) {
    return '주문 금액이 너무 큽니다';
  }
  if (side === 'sell') {
    // Whole shares on both sides, so comparing as integers is exact.
    const held = row.held === null ? 0n : BigInt(row.held.split('.')[0]);
    if (BigInt(quantity) > held) return '보유 수량이 부족합니다';
    if (cash + amount - fee > maxWon) return '계좌 현금 한도를 넘습니다';
  }
  return null;
}

/** What the account's cash changes by: minus the amount and fee for a buy, plus the amount less fee for a sale. */
function cashChange(row: QuoteRow, side: Side) {
  const amount = BigInt(row.amount_krw!);
  const fee = BigInt(row.fee_krw!);
  return side === 'buy' ? -(amount + fee) : amount - fee;
}

type OrderRow = {
  id: string;
  account_id: string;
  security_id: string;
  request_key: string;
  side: Side;
  quantity: string;
  price: string;
  currency: 'KRW' | 'USD';
  price_date: string;
  fx_rate: string | null;
  fx_date: string | null;
  amount_krw: string;
  fee_krw: string;
  cash_after_krw: string;
  created_at: Date;
  symbol: string;
  name: string | null;
};

const orderColumns = `o.id, o.account_id, o.security_id, o.request_key, o.side, o.quantity, o.price, o.currency,
  o.price_date, o.fx_rate, o.fx_date, o.amount_krw, o.fee_krw, o.cash_after_krw, o.created_at, s.symbol, s.name`;

// Won amounts stay within the 1,000조 CHECK of 015, so they are exact as JSON numbers.
const toOrder = (row: OrderRow) => ({
  id: Number(row.id),
  accountId: Number(row.account_id),
  security: { id: Number(row.security_id), symbol: row.symbol, name: row.name },
  side: row.side,
  quantity: row.quantity,
  price: row.price,
  currency: row.currency,
  priceDate: row.price_date,
  fxRate: row.fx_rate,
  fxDate: row.fx_date,
  amountKrw: Number(row.amount_krw),
  feeKrw: Number(row.fee_krw),
  cashAfterKrw: Number(row.cash_after_krw),
  createdAt: row.created_at.toISOString(),
});

async function account(db: Db, id: number, lock: boolean) {
  const { rows } = await db.query<Account>(
    `SELECT id, cash_krw, fee_rate, closed_at FROM mock_accounts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const found = rows[0];
  if (!found) throw new HttpError(404, '모의투자 계좌를 찾을 수 없습니다');
  if (found.closed_at !== null) {
    throw new HttpError(409, '초기화된 계좌입니다. 화면을 새로 고친 뒤 다시 시도하세요');
  }
  return found;
}

export function mockOrdersRouter(pool: Pool, today: () => string) {
  const router = Router({ mergeParams: true });

  // What the order would do now, for the confirmation step. Nothing is saved.
  router.get('/preview', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, '모의투자 계좌');
    const query = previewQuery.parse(req.query);
    const found = await account(pool, accountId, false);
    const row = await quote(pool, found, Number(query.securityId), query.quantity, today());
    const problem = problemOf(found, row, query.side, query.quantity);
    const change = problem === null ? cashChange(row, query.side) : null;
    res.json({
      security: { id: Number(row.id), symbol: row.symbol, name: row.name, currency: row.currency },
      side: query.side,
      quantity: query.quantity,
      price: row.close,
      priceDate: row.trade_date,
      priceStale: row.stale === true,
      fxRate: row.fx_rate,
      fxDate: row.rate_date,
      amountKrw: row.amount_krw === null ? null : Number(row.amount_krw),
      feeKrw: row.fee_krw === null ? null : Number(row.fee_krw),
      cashKrw: Number(found.cash_krw),
      cashAfterKrw: change === null ? null : Number(BigInt(found.cash_krw) + change),
      heldQuantity: row.held ?? '0',
      problem,
    });
  });

  router.post('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, '모의투자 계좌');
    const body = orderBody.parse(req.body);
    const result = await inTransaction(pool, async (client) => {
      // The account row lock puts orders of one account in a line, so a repeated request sees the first one.
      const found = await account(client, accountId, true);
      const earlier = await client.query<OrderRow>(
        `SELECT ${orderColumns} FROM mock_orders o JOIN securities s ON s.id = o.security_id
         WHERE o.request_key = $1`,
        [body.requestKey],
      );
      const first = earlier.rows[0];
      if (first) {
        const same =
          Number(first.account_id) === accountId &&
          Number(first.security_id) === body.securityId &&
          first.side === body.side &&
          BigInt(first.quantity.split('.')[0]) === BigInt(body.quantity);
        if (!same) throw new HttpError(409, '같은 주문 키로 다른 주문을 보냈습니다');
        return { order: first, cashKrw: found.cash_krw, created: false };
      }

      const row = await quote(client, found, body.securityId, body.quantity, today());
      const problem = problemOf(found, row, body.side, body.quantity);
      if (problem !== null) throw new HttpError(409, problem);
      if (
        row.close !== body.expectedPrice ||
        row.trade_date !== body.expectedPriceDate ||
        row.fx_rate !== body.expectedFxRate
      ) {
        throw new HttpError(409, '시세가 바뀌었습니다. 주문을 다시 확인하세요');
      }

      const cash = await client.query<{ cash_krw: string }>(
        'UPDATE mock_accounts SET cash_krw = cash_krw + $2 WHERE id = $1 RETURNING cash_krw',
        [accountId, cashChange(row, body.side).toString()],
      );
      if (body.side === 'buy') {
        await client.query(
          `INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id, security_id) DO UPDATE SET
             quantity = mock_holdings.quantity + EXCLUDED.quantity,
             cost_krw = mock_holdings.cost_krw + EXCLUDED.cost_krw, updated_at = now()`,
          [accountId, body.securityId, body.quantity, (-cashChange(row, body.side)).toString()],
        );
      } else {
        // Selling every share removes the holding (a row never has quantity 0). Otherwise average cost: the
        // shares sold take their share of the cost with them.
        const emptied = await client.query(
          'DELETE FROM mock_holdings WHERE account_id = $1 AND security_id = $2 AND quantity = $3::numeric',
          [accountId, body.securityId, body.quantity],
        );
        if (!emptied.rowCount) {
          await client.query(
            `UPDATE mock_holdings SET quantity = quantity - $3::numeric,
               cost_krw = round(cost_krw * (quantity - $3::numeric) / quantity), updated_at = now()
             WHERE account_id = $1 AND security_id = $2`,
            [accountId, body.securityId, body.quantity],
          );
        }
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
           price_date, fx_rate, fx_date, amount_krw, fee_krw, cash_after_krw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          accountId,
          body.securityId,
          body.requestKey,
          body.side,
          body.quantity,
          row.close,
          row.currency,
          row.trade_date,
          row.fx_rate,
          row.rate_date,
          row.amount_krw,
          row.fee_krw,
          cash.rows[0].cash_krw,
        ],
      );
      const order = await client.query<OrderRow>(
        `SELECT ${orderColumns} FROM mock_orders o JOIN securities s ON s.id = o.security_id WHERE o.id = $1`,
        [inserted.rows[0].id],
      );
      return { order: order.rows[0], cashKrw: cash.rows[0].cash_krw, created: true };
    }).catch((error: unknown) => {
      // The same key sent at once for two accounts passes both account locks; the unique key stops one.
      const pg = error as { code?: unknown; constraint?: unknown } | null;
      if (pg?.code === '23505' && pg.constraint === 'mock_orders_request_key_key') {
        throw new HttpError(409, '같은 주문 키로 다른 주문을 보냈습니다');
      }
      throw error;
    });
    res
      .status(result.created ? 201 : 200)
      .json({ order: toOrder(result.order), cashKrw: Number(result.cashKrw) });
  });

  return router;
}
