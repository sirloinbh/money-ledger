import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON, serviceDate as date } from '../contract.js';
import { inTransaction } from '../db.js';
import { won } from '../money.js';
import { HttpError, parseId, serviceTimeZone } from '../standard/http.js';
import { saveSnapshot } from './snapshots.js';

// #52 Mock trading market orders (decisions 2026-11-08, issue comment):
// - One won cash balance. A US order is converted with the latest stored USD deal base rate at order time:
//   amount_krw = round(quantity × price × fx_rate), all in SQL numeric (AGENTS.project.md).
// - The fill price is the latest stored close on the server (docs/price-source.md), never a client value.
//   Orders fill at once whatever the time of day, and the screen says which day's close was used.
// - Fee = round(amount_krw × the account's fee rate), 0 by default. No taxes.
// - Whole shares only. Inactive securities (#97) cannot be bought; they can be sold.
// - A request key from the screen makes a repeated request return the first order instead of a second fill.

const maxQuantity = 1_000_000;
// The one won cap (#186); the CHECK ceiling of cash and amounts in 015 (10^15) stays as a backstop.
const maxWon = BigInt(MAX_WON);

const quantityField = z
  .string({ error: 'Enter the quantity' })
  .regex(/^[1-9]\d{0,6}$/, 'Enter the quantity as a whole number of shares')
  .refine((text) => Number(text) <= maxQuantity, 'Enter 1,000,000 shares or fewer');
const sideField = z.enum(['buy', 'sell'], { error: 'Choose buy or sell' });
const securityField = z
  .string({ error: 'Choose a security' })
  .regex(/^[1-9]\d{0,14}$/, 'The security ID is not valid');

// #293 A journal note: trimmed, and empty text means "no note" (stored as NULL).
const noteField = z
  .string({ error: 'The note must be text' })
  .max(1000, 'Keep the note to 1,000 characters or fewer')
  .transform((text) => text.trim() || null)
  .nullable();

export const noteBody = z
  .object(
    {
      note: noteField.optional().describe('Why the order was placed; null or empty clears it.'),
      reviewNote: noteField
        .optional()
        .describe('A later look back at the order; null or empty clears it.'),
    },
    { error: 'The request body must be a JSON object' },
  )
  .refine((body) => body.note !== undefined || body.reviewNote !== undefined, {
    error: 'Send a note or a review note',
    path: ['note'],
  });

export const journalQuery = z.object({
  before: z
    .string({ error: 'The continuation position is not valid' })
    .regex(/^[1-9]\d{0,14}$/, 'The continuation position is not valid')
    .optional(),
});

export const orderBody = z.object(
  {
    securityId: z
      .number({ error: 'Choose a security' })
      .int('The security ID is not valid')
      .positive('The security ID is not valid'),
    side: sideField,
    quantity: quantityField,
    requestKey: z.uuid({ error: 'The order key is not valid' }),
    // What the confirmation showed. The fill still uses the server's latest close and rate; these are only
    // compared with them, so an order never fills at a price the person did not see (#52 review).
    // The price and rate are compared as numbers (#196): "80000" matches "80000.0000".
    expectedPrice: z
      .string({ error: 'No confirmed quote. Review the order again' })
      .max(30, 'The confirmed quote is not valid')
      .nullable()
      .describe(
        'The close the confirmation showed, as a plain decimal string such as "70600.0000" or "70600". Compared with the stored close as a number.',
      ),
    expectedPriceDate: z
      .string({ error: 'No confirmed quote. Review the order again' })
      .max(10, 'The confirmed quote is not valid')
      .nullable()
      .describe('The trade date of that close, YYYY-MM-DD.'),
    note: noteField
      .optional()
      .describe('Why the order is placed (#293); optional, up to 1,000 characters.'),
    expectedFxRate: z
      .string({ error: 'No confirmed quote. Review the order again' })
      .max(30, 'The confirmed quote is not valid')
      .nullable()
      .describe(
        'The USD rate the confirmation showed, as a plain decimal string such as "1384.5000"; null for a won security. Compared as a number.',
      ),
  },
  { error: 'The request body must be a JSON object' },
);

export const previewQuery = z.object({
  securityId: securityField,
  side: sideField,
  quantity: quantityField,
});

// #54 Order history of an account, newest first, a page at a time. Dates are order days in the service time
// zone (KST). `before` is the id of the last order already shown.
const historyPage = 50;
export const historyQuery = z
  .object({
    from: date.optional(),
    to: date.optional(),
    securityId: securityField.optional(),
    before: z
      .string({ error: 'The continuation position is not valid' })
      .regex(/^[1-9]\d{0,14}$/, 'The continuation position is not valid')
      .optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: 'The start date cannot be after the end date',
    path: ['from'],
  });

type Side = 'buy' | 'sell';
type Db = Pool | PoolClient;
type Account = { id: number; cash_krw: string; fee_rate: string; closed_at: Date | null };

type QuoteRow = {
  id: number;
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
  if (!row) throw new HttpError(404, 'Security not found');
  return row;
}

/** The reason the order cannot fill, or null. The same checks run for the preview and the order. */
function problemOf(account: Account, row: QuoteRow, side: Side, quantity: string) {
  if (side === 'buy' && !row.active) return 'A security with trading halted cannot be bought';
  if (row.close === null) return 'No saved close, so the order cannot be placed';
  if (row.currency === 'USD' && row.fx_rate === null) {
    return 'No saved exchange rate, so a US stock cannot be ordered';
  }
  const amount = BigInt(row.amount_krw!);
  const fee = BigInt(row.fee_krw!);
  const cash = BigInt(account.cash_krw);
  if (amount > maxWon) return 'The order amount is too large';
  if (side === 'buy' && amount + fee > cash) return 'Not enough cash';
  // The cost of a holding has the same ceiling as cash.
  if (side === 'buy' && BigInt(row.held_cost ?? '0') + amount + fee > maxWon) {
    return 'The order amount is too large';
  }
  if (side === 'sell') {
    // Whole shares on both sides, so comparing as integers is exact.
    const held = row.held === null ? 0n : BigInt(row.held.split('.')[0]);
    if (BigInt(quantity) > held) return 'Not enough shares held';
    if (cash + amount - fee > maxWon) return 'The account cash limit would be exceeded';
  }
  return null;
}

const plainDecimal = /^(\d+)(?:\.(\d+))?$/;

/** A plain decimal string without leading zeros in the whole part or trailing zeros in the fraction, or null. */
function canonicalDecimal(text: string) {
  const match = plainDecimal.exec(text);
  if (!match) return null;
  // Plain loops, not regular expressions: a long run of zeros in a user-sent value costs only a linear scan.
  let start = 0;
  while (start < match[1].length - 1 && match[1][start] === '0') start += 1;
  const whole = match[1].slice(start);
  const rest = match[2] ?? '';
  let end = rest.length;
  while (end > 0 && rest[end - 1] === '0') end -= 1;
  const fraction = rest.slice(0, end);
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Whether a stored numeric and a value the screen sent name the same number (#196), so `"80000"` matches
 * `"80000.0000"`. Exact on the digits, never through a JS number. Text that is not a plain decimal never matches.
 */
export function sameDecimal(stored: string | null, sent: string | null) {
  if (stored === null || sent === null) return stored === sent;
  const canonical = canonicalDecimal(sent);
  return canonical !== null && canonical === canonicalDecimal(stored);
}

/** What the account's cash changes by: minus the amount and fee for a buy, plus the amount less fee for a sale. */
function cashChange(row: QuoteRow, side: Side) {
  const amount = BigInt(row.amount_krw!);
  const fee = BigInt(row.fee_krw!);
  return side === 'buy' ? -(amount + fee) : amount - fee;
}

type OrderRow = {
  id: number;
  account_id: number;
  security_id: number;
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
  tax_krw: string;
  cash_after_krw: string;
  note: string | null;
  review_note: string | null;
  created_at: Date;
  symbol: string;
  name: string | null;
};

type JournalRow = OrderRow & { realized_krw: string | null; current_krw: string | null };

const orderColumns = `o.id, o.account_id, o.security_id, o.request_key, o.side, o.quantity, o.price, o.currency,
  o.price_date, o.fx_rate, o.fx_date, o.amount_krw, o.fee_krw, o.tax_krw, o.cash_after_krw, o.note, o.review_note,
  o.created_at, s.symbol, s.name`;

// Won amounts stay within MAX_WON (and the 10^15 CHECK of 015), so they are exact as JSON numbers.
const toOrder = (row: OrderRow) => ({
  id: row.id,
  accountId: row.account_id,
  security: { id: row.security_id, symbol: row.symbol, name: row.name },
  side: row.side,
  quantity: row.quantity,
  price: row.price,
  currency: row.currency,
  priceDate: row.price_date,
  fxRate: row.fx_rate,
  fxDate: row.fx_date,
  amountKrw: won(row.amount_krw),
  feeKrw: won(row.fee_krw),
  taxKrw: won(row.tax_krw),
  cashAfterKrw: won(row.cash_after_krw),
  note: row.note,
  reviewNote: row.review_note,
  createdAt: row.created_at.toISOString(),
});

async function account(db: Db, id: number, lock: boolean) {
  const { rows } = await db.query<Account>(
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

export function mockOrdersRouter(pool: Pool, today: () => string) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const query = historyQuery.parse(req.query);
    const exists = await pool.query('SELECT 1 FROM mock_accounts WHERE id = $1', [accountId]);
    if (!exists.rowCount) throw new HttpError(404, 'Mock trading account not found');
    const values: unknown[] = [accountId];
    const where = ['o.account_id = $1'];
    const add = (sql: (n: string) => string, value: unknown) => {
      values.push(value);
      where.push(sql(`$${values.length}`));
    };
    const day = `(o.created_at AT TIME ZONE '${serviceTimeZone}')::date`;
    if (query.from) add((n) => `${day} >= ${n}::date`, query.from);
    if (query.to) add((n) => `${day} <= ${n}::date`, query.to);
    if (query.securityId) add((n) => `o.security_id = ${n}`, query.securityId);
    if (query.before) add((n) => `o.id < ${n}`, query.before);
    // One more than a page tells whether there is a next one. Ids grow with each order, so they order them;
    // orders of one account are in a line behind its row lock, so an id never commits after a later one.
    const { rows } = await pool.query<OrderRow>(
      `SELECT ${orderColumns} FROM mock_orders o JOIN securities s ON s.id = o.security_id
       WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT ${historyPage + 1}`,
      values,
    );
    // Every security this account has traded, for the filter, whatever the other conditions are.
    const traded = await pool.query<{ id: number; symbol: string; name: string | null }>(
      `SELECT DISTINCT s.id, s.symbol, s.name FROM mock_orders o JOIN securities s ON s.id = o.security_id
       WHERE o.account_id = $1 ORDER BY s.name NULLS LAST, s.symbol`,
      [accountId],
    );
    res.json({
      orders: rows.slice(0, historyPage).map(toOrder),
      hasMore: rows.length > historyPage,
      securities: traded.rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        name: row.name,
      })),
    });
  });

  // #293 The journal: every order with its notes and the result so far, newest first, a page at a time.
  // - A buy that became a position (#307) and was sold shows that position's realized net gain.
  // - Any other buy shows the gain if its shares were sold at the latest saved close (and rate), in SQL numeric.
  // - A sale shows the realized gain of its position; a close-price sale (#52) has no cost basis of its own yet
  //   (#295), so its result is null rather than a guess.
  router.get('/journal', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const query = journalQuery.parse(req.query);
    const exists = await pool.query('SELECT 1 FROM mock_accounts WHERE id = $1', [accountId]);
    if (!exists.rowCount) throw new HttpError(404, 'Mock trading account not found');
    const values: unknown[] = [accountId];
    let before = '';
    if (query.before) {
      values.push(query.before);
      before = 'AND o.id < $2';
    }
    const { rows } = await pool.query<JournalRow>(
      `SELECT ${orderColumns}, pos.net_gain_krw AS realized_krw,
              CASE WHEN o.side = 'buy' AND pos.closed_at IS NULL AND p.close IS NOT NULL
                        AND (o.currency = 'KRW' OR fx.fx_rate IS NOT NULL)
                   THEN round(o.quantity * p.close * coalesce(fx.fx_rate, 1)) - o.amount_krw - o.fee_krw
              END AS current_krw
       FROM mock_orders o
       JOIN securities s ON s.id = o.security_id
       LEFT JOIN mock_positions pos ON pos.buy_order_id = o.id OR pos.sell_order_id = o.id
       LEFT JOIN LATERAL (
         SELECT close FROM security_prices WHERE security_id = o.security_id ORDER BY trade_date DESC LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT fx_rate FROM fx_rates WHERE currency = 'USD' AND o.currency = 'USD'
         ORDER BY rate_date DESC LIMIT 1
       ) fx ON true
       WHERE o.account_id = $1 ${before} ORDER BY o.id DESC LIMIT ${historyPage + 1}`,
      values,
    );
    res.json({
      entries: rows.slice(0, historyPage).map((row) => ({
        ...toOrder(row),
        result:
          row.realized_krw !== null
            ? { kind: 'realized' as const, gainKrw: won(row.realized_krw) }
            : row.current_krw !== null
              ? { kind: 'current' as const, gainKrw: won(row.current_krw) }
              : null,
      })),
      hasMore: rows.length > historyPage,
    });
  });

  // #293 Write or change the note and the review note of one order. Only the sent fields change.
  router.patch('/:id/notes', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const id = parseId(req.params.id, 'order');
    const body = noteBody.parse(req.body);
    const sets: string[] = [];
    const values: unknown[] = [id, accountId];
    if (body.note !== undefined) {
      values.push(body.note);
      sets.push(`note = $${values.length}`);
    }
    if (body.reviewNote !== undefined) {
      values.push(body.reviewNote);
      sets.push(`review_note = $${values.length}`);
    }
    const updated = await pool.query(
      `UPDATE mock_orders SET ${sets.join(', ')} WHERE id = $1 AND account_id = $2`,
      values,
    );
    if (!updated.rowCount) throw new HttpError(404, 'Order not found');
    const { rows } = await pool.query<OrderRow>(
      `SELECT ${orderColumns} FROM mock_orders o JOIN securities s ON s.id = o.security_id WHERE o.id = $1`,
      [id],
    );
    res.json({ order: toOrder(rows[0]) });
  });

  // What the order would do now, for the confirmation step. Nothing is saved.
  router.get('/preview', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const query = previewQuery.parse(req.query);
    const found = await account(pool, accountId, false);
    const row = await quote(pool, found, Number(query.securityId), query.quantity, today());
    const problem = problemOf(found, row, query.side, query.quantity);
    const change = problem === null ? cashChange(row, query.side) : null;
    res.json({
      security: { id: row.id, symbol: row.symbol, name: row.name, currency: row.currency },
      side: query.side,
      quantity: query.quantity,
      price: row.close,
      priceDate: row.trade_date,
      priceStale: row.stale === true,
      fxRate: row.fx_rate,
      fxDate: row.rate_date,
      amountKrw: won(row.amount_krw),
      feeKrw: won(row.fee_krw),
      cashKrw: Number(found.cash_krw),
      cashAfterKrw: change === null ? null : Number(BigInt(found.cash_krw) + change),
      heldQuantity: row.held ?? '0',
      problem,
    });
  });

  router.post('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const body = orderBody.parse(req.body);
    // One service date for the whole order, so an order at KST midnight never mixes two days (#196).
    const day = today();
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
          first.account_id === accountId &&
          first.security_id === body.securityId &&
          first.side === body.side &&
          BigInt(first.quantity.split('.')[0]) === BigInt(body.quantity);
        if (!same) throw new HttpError(409, 'A different order was sent with the same order key');
        // A replay answers with what the first fill left, not the cash after later orders (#196).
        return { order: first, cashKrw: first.cash_after_krw, created: false };
      }

      const row = await quote(client, found, body.securityId, body.quantity, day);
      const problem = problemOf(found, row, body.side, body.quantity);
      if (problem !== null) throw new HttpError(409, problem);
      if (
        !sameDecimal(row.close, body.expectedPrice) ||
        row.trade_date !== body.expectedPriceDate ||
        !sameDecimal(row.fx_rate, body.expectedFxRate)
      ) {
        throw new HttpError(409, 'The quote changed. Review the order again');
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
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
           price_date, fx_rate, fx_date, amount_krw, fee_krw, cash_after_krw, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
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
          body.note ?? null,
        ],
      );
      // The day's value for the return chart (#54), in the same transaction as the order.
      await saveSnapshot(client, accountId, day, day);
      const order = await client.query<OrderRow>(
        `SELECT ${orderColumns} FROM mock_orders o JOIN securities s ON s.id = o.security_id WHERE o.id = $1`,
        [inserted.rows[0].id],
      );
      return { order: order.rows[0], cashKrw: cash.rows[0].cash_krw, created: true };
    }).catch((error: unknown) => {
      // The same key sent at once for two accounts passes both account locks; the unique key stops one.
      const pg = error as { code?: unknown; constraint?: unknown } | null;
      if (pg?.code === '23505' && pg.constraint === 'mock_orders_request_key_key') {
        throw new HttpError(409, 'A different order was sent with the same order key');
      }
      throw error;
    });
    res
      .status(result.created ? 201 : 200)
      .json({ order: toOrder(result.order), cashKrw: Number(result.cashKrw) });
  });

  return router;
}
