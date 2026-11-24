import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON } from '../contract.js';
import { inTransaction } from '../db.js';
import { won } from '../money.js';
import type { KisSource } from '../prices/kis.js';
import { HttpError, parseId } from '../standard/http.js';
import { sameDecimal } from './orders.js';
import { liveQuote } from './quotes.js';
import { saveSnapshot } from './snapshots.js';

// #307 Mock investing v2: positions bought all-in at the best ask and sold at the best bid (#305 order book).
// - All-in quantity = the most whole shares whose amount plus buy fee fits the cash, found in SQL numeric:
//   amount = round(quantity × ask), fee = round(amount × account fee rate).
// - A sale takes the best bid and costs the commission (account fee rate) and the securities transaction tax:
//   tax = round(amount × SALE_TAX_RATE). The cash gained is amount − fee − tax.
// - A position starts `undecided`; the user (or a rule) chooses `day_trade` or `long_hold` once, and the time
//   and the way it was chosen are kept. #309 sells day trades, #310 asks about long holds each morning.
// - The close-price orders of #52 stay as they are: this file adds a second way to fill, marked 'book'.

/**
 * The securities transaction tax on a sale, a share of the sale amount (0.2%): KOSPI 0.05% tax + 0.15% rural
 * development special tax, KOSDAQ 0.20%, for sales from 2026-01-01. Taken from news reports of the 2026 tax law
 * revision; no official page was reachable when this was written (docs/changes/307-all-in-buy-strategy.md).
 */
const SALE_TAX_RATE = '0.0020';

const maxWon = BigInt(MAX_WON);
const closedShown = 20;

type Db = Pool | PoolClient;
type AccountRow = { id: number; cash_krw: string; fee_rate: string; closed_at: Date | null };

export const buyBody = z.object(
  {
    securityId: z
      .number({ error: 'Choose a security' })
      .int('The security ID is not valid')
      .positive('The security ID is not valid'),
    requestKey: z.uuid({ error: 'The order key is not valid' }),
    expectedAsk: z
      .string({ error: 'No confirmed quote. Review the order again' })
      .max(30, 'The confirmed quote is not valid')
      .describe('The best ask the review showed, a whole-won decimal string such as "70100".'),
  },
  { error: 'The request body must be a JSON object' },
);
export const previewQuery = z.object({
  securityId: z
    .string({ error: 'Choose a security' })
    .regex(/^[1-9]\d{0,14}$/, 'The security ID is not valid'),
});
export const strategyBody = z.object(
  {
    strategy: z.enum(['day_trade', 'long_hold'], { error: 'Choose day trade or long hold' }),
    source: z.enum(['web', 'kakao']).default('web').describe('Where the choice was made.'),
  },
  { error: 'The request body must be a JSON object' },
);

async function openAccount(db: Db, id: number, lock: boolean) {
  const { rows } = await db.query<AccountRow>(
    `SELECT id, cash_krw, fee_rate, closed_at FROM mock_accounts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const found = rows[0];
  if (!found) throw new HttpError(404, 'Mock trading account not found');
  if (found.closed_at !== null) {
    throw new HttpError(409, 'This account was already reset. Refresh the page and try again');
  }
  return found;
}

/**
 * The most whole shares that `cash` pays for at `ask`, fee included, or null when not even one fits. The first
 * guess is the exact division; the fee rounds to whole won, so the share before and after it are checked too.
 */
export async function allInQuantity(db: Db, cash: string, ask: string, feeRate: string) {
  const { rows } = await db.query<{ quantity: string | null }>(
    `WITH guess AS (SELECT floor($1::numeric / ($2::numeric * (1 + $3::numeric))) AS n)
     SELECT max(q)::bigint::text AS quantity
     FROM guess, generate_series(greatest(guess.n - 1, 1), guess.n + 1) AS q
     WHERE q * $2::numeric + round(q * $2::numeric * $3::numeric) <= $1::numeric`,
    [cash, ask, feeRate],
  );
  return rows[0].quantity;
}

type Amounts = { amount: string; fee: string; tax: string };

/** The won amounts of `quantity` shares at a whole-won `price`, all in SQL numeric. */
async function amountsOf(db: Db, quantity: string, price: string, feeRate: string) {
  const { rows } = await db.query<Amounts>(
    `SELECT a::text AS amount, round(a * $3::numeric)::text AS fee, round(a * $4::numeric)::text AS tax
     FROM (SELECT round($1::numeric * $2::numeric) AS a) t`,
    [quantity, price, feeRate, SALE_TAX_RATE],
  );
  return rows[0];
}

type PositionRow = {
  id: number;
  account_id: number;
  security_id: number;
  symbol: string;
  name: string | null;
  quantity: string;
  strategy: 'undecided' | 'day_trade' | 'long_hold';
  strategy_chosen_at: Date | null;
  strategy_source: string | null;
  opened_at: Date;
  closed_at: Date | null;
  buy_price: string;
  buy_amount: string;
  buy_fee: string;
  exit_reason: 'take_profit' | 'stop_loss' | 'manual' | null;
  net_gain_krw: string | null;
  net_gain_pct: string | null;
  carried_over_at: Date | null;
  sell_price: string | null;
  sell_amount: string | null;
  sell_fee: string | null;
  sell_tax: string | null;
};

const positionSelect = `
  SELECT p.id, p.account_id, p.security_id, s.symbol, s.name, p.quantity, p.strategy, p.strategy_chosen_at,
         p.strategy_source, p.opened_at, p.closed_at, p.exit_reason, p.net_gain_krw, p.net_gain_pct,
         p.carried_over_at,
         b.price AS buy_price, b.amount_krw AS buy_amount, b.fee_krw AS buy_fee,
         e.price AS sell_price, e.amount_krw AS sell_amount, e.fee_krw AS sell_fee, e.tax_krw AS sell_tax
  FROM mock_positions p
  JOIN securities s ON s.id = p.security_id
  JOIN mock_orders b ON b.id = p.buy_order_id
  LEFT JOIN mock_orders e ON e.id = p.sell_order_id`;

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

const toPosition = (row: PositionRow) => ({
  id: row.id,
  accountId: row.account_id,
  security: { id: row.security_id, symbol: row.symbol, name: row.name },
  quantity: row.quantity,
  strategy: row.strategy,
  strategyChosenAt: iso(row.strategy_chosen_at),
  strategySource: row.strategy_source,
  openedAt: row.opened_at.toISOString(),
  closedAt: iso(row.closed_at),
  carriedOverAt: iso(row.carried_over_at),
  exitReason: row.exit_reason,
  netGainKrw: row.net_gain_krw === null ? null : won(row.net_gain_krw),
  netGainPct: row.net_gain_pct,
  buy: { price: row.buy_price, amountKrw: won(row.buy_amount), feeKrw: won(row.buy_fee) },
  sell:
    row.sell_price === null
      ? null
      : {
          price: row.sell_price,
          amountKrw: won(row.sell_amount),
          feeKrw: won(row.sell_fee),
          taxKrw: won(row.sell_tax),
        },
});

async function positionById(db: Db, id: number) {
  const { rows } = await db.query<PositionRow>(`${positionSelect} WHERE p.id = $1`, [id]);
  return rows[0];
}

async function koreanSecurity(db: Db, id: number) {
  const { rows } = await db.query<{
    symbol: string;
    name: string | null;
    active: boolean;
    currency: string;
  }>('SELECT symbol, name, active, currency FROM securities WHERE id = $1', [id]);
  const found = rows[0];
  if (!found) throw new HttpError(404, 'Security not found');
  if (found.currency !== 'KRW') {
    throw new HttpError(409, 'All-in orders are only available for Korean securities');
  }
  if (!found.active) throw new HttpError(409, 'Trading is halted for this security');
  return found;
}

/** The best ask of a live quote, or a 409 when the book has none. */
async function bestAsk(kis: KisSource | undefined, symbol: string) {
  const quote = await liveQuote(kis, symbol);
  const ask = quote.asks[0]?.price;
  if (!ask) throw new HttpError(409, 'There is no ask in the order book right now');
  return { ask, readAt: quote.readAt };
}

/** What an all-in buy would do now, nothing saved. `problem` says why it cannot fill. */
async function previewAllIn(pool: Pool, accountId: number, securityId: number, kis?: KisSource) {
  const account = await openAccount(pool, accountId, false);
  const security = await koreanSecurity(pool, securityId);
  const { ask, readAt } = await bestAsk(kis, security.symbol);
  const quantity = await allInQuantity(pool, account.cash_krw, ask, account.fee_rate);
  const amounts = quantity === null ? null : await amountsOf(pool, quantity, ask, account.fee_rate);
  const total = amounts === null ? null : BigInt(amounts.amount) + BigInt(amounts.fee);
  return {
    security: { id: securityId, symbol: security.symbol, name: security.name },
    ask,
    readAt,
    quantity,
    amountKrw: amounts === null ? null : won(amounts.amount),
    feeKrw: amounts === null ? null : won(amounts.fee),
    cashKrw: Number(account.cash_krw),
    cashAfterKrw: total === null ? null : Number(BigInt(account.cash_krw) - total),
    problem:
      quantity === null
        ? 'Not enough cash for one share at the best ask'
        : total! > maxWon
          ? 'The order amount is too large'
          : null,
  };
}

/**
 * Buys all-in at the best ask. A repeated request key returns the first position.
 * @public Called by the pick job (#308) and the chatbot (#312) as well as the route.
 */
export async function buyAllIn(
  pool: Pool,
  kis: KisSource | undefined,
  today: () => string,
  accountId: number,
  body: z.infer<typeof buyBody>,
) {
  const earlierPosition = async (db: Db) => {
    const { rows } = await db.query<{ id: number; account_id: number; security_id: number }>(
      `SELECT p.id, p.account_id, p.security_id FROM mock_orders o
       JOIN mock_positions p ON p.buy_order_id = o.id WHERE o.request_key = $1`,
      [body.requestKey],
    );
    const first = rows[0];
    if (!first) return undefined;
    if (first.account_id !== accountId || first.security_id !== body.securityId) {
      throw new HttpError(409, 'A different order was sent with the same order key');
    }
    return await positionById(db, first.id);
  };
  // A replay answers with the first fill even if the market closed since, so it is read before the quote.
  const replay = await earlierPosition(pool);
  if (replay) return { position: replay, created: false };

  const security = await koreanSecurity(pool, body.securityId);
  // The quote is read before the transaction, so no row lock is held while KIS answers.
  const { ask } = await bestAsk(kis, security.symbol);
  if (!sameDecimal(ask, body.expectedAsk)) {
    throw new HttpError(409, 'The best ask changed. Review the order again');
  }
  const day = today();

  return inTransaction(pool, async (client) => {
    const account = await openAccount(client, accountId, true);
    const again = await earlierPosition(client);
    if (again) return { position: again, created: false };

    const quantity = await allInQuantity(client, account.cash_krw, ask, account.fee_rate);
    if (quantity === null)
      throw new HttpError(409, 'Not enough cash for one share at the best ask');
    const amounts = await amountsOf(client, quantity, ask, account.fee_rate);
    const total = BigInt(amounts.amount) + BigInt(amounts.fee);
    const held = await client.query<{ cost_krw: string }>(
      'SELECT cost_krw FROM mock_holdings WHERE account_id = $1 AND security_id = $2',
      [accountId, body.securityId],
    );
    if (total > maxWon || BigInt(held.rows[0]?.cost_krw ?? '0') + total > maxWon) {
      throw new HttpError(409, 'The order amount is too large');
    }

    const cash = await client.query<{ cash_krw: string }>(
      'UPDATE mock_accounts SET cash_krw = cash_krw - $2 WHERE id = $1 RETURNING cash_krw',
      [accountId, total.toString()],
    );
    await client.query(
      `INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, security_id) DO UPDATE SET
         quantity = mock_holdings.quantity + EXCLUDED.quantity,
         cost_krw = mock_holdings.cost_krw + EXCLUDED.cost_krw, updated_at = now()`,
      [accountId, body.securityId, quantity, total.toString()],
    );
    const order = await client.query<{ id: number }>(
      `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
         price_date, amount_krw, fee_krw, cash_after_krw, fill_source)
       VALUES ($1, $2, $3, 'buy', $4, $5, 'KRW', $6, $7, $8, $9, 'book') RETURNING id`,
      [
        accountId,
        body.securityId,
        body.requestKey,
        quantity,
        ask,
        day,
        amounts.amount,
        amounts.fee,
        cash.rows[0].cash_krw,
      ],
    );
    const position = await client.query<{ id: number }>(
      `INSERT INTO mock_positions (account_id, security_id, buy_order_id, quantity) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [accountId, body.securityId, order.rows[0].id, quantity],
    );
    await saveSnapshot(client, accountId, day, day);
    return { position: await positionById(client, position.rows[0].id), created: true };
  });
}

/**
 * Sells a whole open position at the best bid, with commission and transaction tax. Used by the day trade
 * rule (#309) and the morning keep-or-sell answer (#310). A position that is already closed is a 409, so a
 * repeated call never sells twice.
 */
export async function sellPosition(
  pool: Pool,
  kis: KisSource | undefined,
  today: () => string,
  positionId: number,
  // #309 Why it is sold: the day trade rule passes 'take_profit' or 'stop_loss'; any other sale is 'manual'.
  reason: 'take_profit' | 'stop_loss' | 'manual' = 'manual',
) {
  const open = await positionById(pool, positionId);
  if (!open) throw new HttpError(404, 'Position not found');
  if (open.closed_at !== null) throw new HttpError(409, 'This position is already sold');
  const quote = await liveQuote(kis, open.symbol);
  const bid = quote.bids[0]?.price;
  if (!bid) throw new HttpError(409, 'There is no bid in the order book right now');
  const day = today();

  return inTransaction(pool, async (client) => {
    // The account row lock first (the same order as a buy), then the position.
    const account = await openAccount(client, open.account_id, true);
    const locked = await client.query<{ closed_at: Date | null; quantity: string }>(
      'SELECT closed_at, quantity FROM mock_positions WHERE id = $1 FOR UPDATE',
      [positionId],
    );
    if (locked.rows[0].closed_at !== null) {
      throw new HttpError(409, 'This position is already sold');
    }
    const quantity = locked.rows[0].quantity;
    const amounts = await amountsOf(client, quantity, bid, account.fee_rate);
    const gain = BigInt(amounts.amount) - BigInt(amounts.fee) - BigInt(amounts.tax);
    if (BigInt(account.cash_krw) + gain > maxWon) {
      throw new HttpError(409, 'The account cash limit would be exceeded');
    }
    const emptied = await client.query(
      'DELETE FROM mock_holdings WHERE account_id = $1 AND security_id = $2 AND quantity = $3::numeric',
      [open.account_id, open.security_id, quantity],
    );
    if (!emptied.rowCount) {
      const reduced = await client.query(
        `UPDATE mock_holdings SET quantity = quantity - $3::numeric,
           cost_krw = round(cost_krw * (quantity - $3::numeric) / quantity), updated_at = now()
         WHERE account_id = $1 AND security_id = $2 AND quantity > $3::numeric`,
        [open.account_id, open.security_id, quantity],
      );
      if (!reduced.rowCount) {
        throw new HttpError(409, 'The shares of this position are no longer held');
      }
    }
    const cash = await client.query<{ cash_krw: string }>(
      'UPDATE mock_accounts SET cash_krw = cash_krw + $2 WHERE id = $1 RETURNING cash_krw',
      [open.account_id, gain.toString()],
    );
    const order = await client.query<{ id: number }>(
      `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
         price_date, amount_krw, fee_krw, tax_krw, cash_after_krw, fill_source)
       VALUES ($1, $2, $3, 'sell', $4, $5, 'KRW', $6, $7, $8, $9, $10, 'book') RETURNING id`,
      [
        open.account_id,
        open.security_id,
        randomUUID(),
        quantity,
        bid,
        day,
        amounts.amount,
        amounts.fee,
        amounts.tax,
        cash.rows[0].cash_krw,
      ],
    );
    // The net gain is worked out in SQL numeric from the two orders: cash after fee and tax minus the buy cost.
    await client.query(
      `UPDATE mock_positions p SET sell_order_id = $2, closed_at = now(), exit_reason = $3,
         net_gain_krw = x.net, net_gain_pct = round(x.net::numeric * 100 / x.cost, 2)
       FROM (SELECT (s.amount_krw - s.fee_krw - s.tax_krw) - (b.amount_krw + b.fee_krw) AS net,
                    (b.amount_krw + b.fee_krw) AS cost
             FROM mock_positions q
             JOIN mock_orders b ON b.id = q.buy_order_id
             JOIN mock_orders s ON s.id = $2
             WHERE q.id = $1) x
       WHERE p.id = $1`,
      [positionId, order.rows[0].id, reason],
    );
    await saveSnapshot(client, open.account_id, day, day);
    return toPosition(await positionById(client, positionId));
  });
}

/**
 * Chooses the strategy of an open, undecided position. The same choice again changes nothing.
 * @public Called by the day trade job (#309) and the chatbot (#312) as well as the route.
 */
export async function chooseStrategy(
  pool: Pool,
  positionId: number,
  strategy: 'day_trade' | 'long_hold',
  source: 'web' | 'kakao' | 'auto',
) {
  const updated = await pool.query(
    `UPDATE mock_positions SET strategy = $2, strategy_chosen_at = now(), strategy_source = $3
     WHERE id = $1 AND closed_at IS NULL AND strategy = 'undecided'`,
    [positionId, strategy, source],
  );
  const position = await positionById(pool, positionId);
  if (!position) throw new HttpError(404, 'Position not found');
  if (!updated.rowCount) {
    if (position.closed_at !== null) throw new HttpError(409, 'This position is already sold');
    if (position.strategy !== strategy) {
      throw new HttpError(409, 'The strategy of this position was already chosen');
    }
  }
  return position;
}

export function mockAccountPositionsRouter(
  pool: Pool,
  today: () => string,
  kis: KisSource | undefined,
) {
  const router = Router({ mergeParams: true });
  const accountOf = (params: unknown) =>
    parseId((params as { accountId?: string }).accountId, 'mock account');

  // The open positions, then the latest closed ones.
  router.get('/', async (req, res) => {
    const accountId = accountOf(req.params);
    const exists = await pool.query('SELECT 1 FROM mock_accounts WHERE id = $1', [accountId]);
    if (!exists.rowCount) throw new HttpError(404, 'Mock trading account not found');
    const { rows } = await pool.query<PositionRow>(
      `${positionSelect} WHERE p.account_id = $1 AND (p.closed_at IS NULL
         OR p.id IN (SELECT id FROM mock_positions WHERE account_id = $1 AND closed_at IS NOT NULL
                     ORDER BY closed_at DESC, id DESC LIMIT ${closedShown}))
       ORDER BY p.closed_at DESC NULLS FIRST, p.id DESC`,
      [accountId],
    );
    res.json({ positions: rows.map(toPosition) });
  });

  router.get('/preview', async (req, res) => {
    const query = previewQuery.parse(req.query);
    res.json(await previewAllIn(pool, accountOf(req.params), Number(query.securityId), kis));
  });

  router.post('/', async (req, res) => {
    const body = buyBody.parse(req.body);
    const result = await buyAllIn(pool, kis, today, accountOf(req.params), body).catch(
      (error: unknown) => {
        const pg = error as { code?: unknown; constraint?: unknown } | null;
        if (pg?.code === '23505' && pg.constraint === 'mock_orders_request_key_key') {
          throw new HttpError(409, 'A different order was sent with the same order key');
        }
        throw error;
      },
    );
    res.status(result.created ? 201 : 200).json({ position: toPosition(result.position) });
  });

  return router;
}

/** `extend` adds routes of later steps to the same router (#310 adds the next-day answer), without an import cycle. */
export function mockPositionsRouter(pool: Pool, extend?: (router: Router) => void) {
  const router = Router();

  router.post('/:id/strategy', async (req, res) => {
    const id = parseId(req.params.id, 'position');
    const body = strategyBody.parse(req.body);
    res.json({ position: toPosition(await chooseStrategy(pool, id, body.strategy, body.source)) });
  });

  extend?.(router);
  return router;
}
