import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON, MAX_WON_TEXT, serviceDate as date } from '../contract.js';
import { won } from '../money.js';
import { HttpError, parseId } from '../standard/http.js';

// #295 Dividends and interest per holding, realized gains per year, and an estimate of the tax on overseas stock
// gains. Mounted at /api/portfolio/income.
// Rules checked on 2026-11-26 (sources in docs/investment-tax.md):
// - Overseas stock gains of one year are added up (losses offset gains, across countries), 2,500,000 won is
//   deducted, and 22% (20% + 2% local) applies to the rest. Domestic stocks are not mixed in.
// - Dividends and interest of up to 20,000,000 won a year are taxed at 15.4% at the source; above that they join the
//   comprehensive income tax. The screen only shows the total against that line.
// The cost basis of a realized gain is the moving average (user decision, 2026-11-26, #295), the same as the
// asset trades (#46); a dollar asset's gain is in won with the trades' own rates.

const overseasDeductionKrw = 2_500_000;
const overseasTaxPercent = 22;
const financialIncomeLineKrw = 20_000_000;

const wonCost = (label: string) =>
  z
    .number({ error: `Enter the ${label} as a number` })
    .int(`Enter the ${label} as a whole number of won`)
    .min(0, `The ${label} must be ₩0 or more`)
    .max(MAX_WON, `Enter a ${label} of ${MAX_WON_TEXT} or less`);

export const incomeBody = z.object(
  {
    assetId: z
      .number({ error: 'Choose a holding' })
      .int('Choose a holding')
      .positive('Choose a holding'),
    kind: z.enum(['dividend', 'interest'], { error: 'Choose dividend or interest' }),
    receivedOn: date,
    // Won receipt: amountKrw. Dollar receipt: amountForeign (numeric(20,4)) and fxRate (numeric(12,4)).
    amountKrw: wonCost('amount').nullable().default(null),
    amountForeign: z
      .string({ error: 'Send the dollar amount as a decimal string' })
      .regex(/^\d{1,16}(\.\d{1,4})?$/, {
        error: 'Enter the dollar amount with up to 16 integer and 4 decimal digits',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), 'The amount must be above 0')
      .nullable()
      .default(null),
    fxRate: z
      .string({ error: 'Send the exchange rate as a decimal string' })
      .regex(/^\d{1,8}(\.\d{1,4})?$/, {
        error: 'Enter the exchange rate with up to 8 integer and 4 decimal digits',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), 'The exchange rate must be above 0')
      .nullable()
      .default(null),
    taxWithheldKrw: wonCost('tax withheld').default(0),
    memo: z
      .string({ error: 'The note must be text' })
      .trim()
      .max(100, 'The note must be 100 characters or fewer')
      .default(''),
  },
  { error: 'The request body must be a JSON object' },
);

const yearQuery = z.object({
  year: z
    .string({ error: 'Enter the year as YYYY' })
    .regex(/^(19|20)\d{2}$/, 'Enter the year as YYYY')
    .optional(),
});

type IncomeRow = {
  id: number;
  asset_id: number;
  asset_name: string;
  kind: 'dividend' | 'interest';
  received_on: string;
  currency: 'KRW' | 'USD';
  amount_foreign: string | null;
  fx_rate: string | null;
  amount_krw: string;
  tax_withheld_krw: string;
  memo: string;
};

type SaleRow = {
  trade_id: number;
  asset_id: number;
  asset_name: string;
  traded_on: string;
  currency: 'KRW' | 'USD';
  realized_krw: string;
};

const incomeColumns = `i.id, i.asset_id, a.name AS asset_name, i.kind, i.received_on::text AS received_on, i.currency,
  i.amount_foreign::text AS amount_foreign, i.fx_rate::text AS fx_rate, i.amount_krw, i.tax_withheld_krw, i.memo`;

const toIncome = (row: IncomeRow) => ({
  id: row.id,
  assetId: row.asset_id,
  assetName: row.asset_name,
  kind: row.kind,
  receivedOn: row.received_on,
  currency: row.currency,
  amountForeign: row.amount_foreign,
  fxRate: row.fx_rate,
  amountKrw: won(row.amount_krw),
  taxWithheldKrw: won(row.tax_withheld_krw),
  memo: row.memo,
});

// Every sell of the year with its moving-average realized gain (the SQL function of migration 013).
const salesOfYear = `FROM portfolio_assets a
  CROSS JOIN LATERAL portfolio_trade_positions(a.id) p
  JOIN portfolio_trades t ON t.id = p.trade_id
  WHERE t.side = 'sell' AND p.realized_krw IS NOT NULL AND t.traded_on >= $1 AND t.traded_on < $2`;

export function incomeRouter(pool: Pool, today: () => string) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = yearQuery.parse(req.query);
    const year = Number(query.year ?? today().slice(0, 4));
    const from = `${year}-01-01`;
    const to = `${year + 1}-01-01`;
    const income = await pool.query<IncomeRow>(
      `SELECT ${incomeColumns} FROM portfolio_income i JOIN portfolio_assets a ON a.id = i.asset_id
       WHERE i.received_on >= $1 AND i.received_on < $2 ORDER BY i.received_on DESC, i.id DESC`,
      [from, to],
    );
    const sales = await pool.query<SaleRow>(
      `SELECT t.id AS trade_id, a.id AS asset_id, a.name AS asset_name, t.traded_on::text AS traded_on,
              t.currency, p.realized_krw ${salesOfYear} ORDER BY t.traded_on DESC, t.id DESC`,
      [from, to],
    );
    // All sums and the tax in numeric, in one place.
    const sums = await pool.query<{
      overseas: string;
      domestic: string;
      taxable: string;
      tax: string;
      dividend: string;
      interest: string;
      withheld: string;
    }>(
      `WITH s AS (SELECT t.currency, p.realized_krw ${salesOfYear}),
       g AS (
         SELECT coalesce(sum(realized_krw) FILTER (WHERE currency <> 'KRW'), 0) AS overseas,
                coalesce(sum(realized_krw) FILTER (WHERE currency = 'KRW'), 0) AS domestic
         FROM s
       ), t AS (
         SELECT overseas, domestic, greatest(overseas - $3::numeric, 0) AS taxable FROM g
       )
       SELECT overseas::text, domestic::text, taxable::text, round(taxable * $4::numeric / 100)::text AS tax,
              (SELECT coalesce(sum(amount_krw), 0)::text FROM portfolio_income
                WHERE kind = 'dividend' AND received_on >= $1 AND received_on < $2) AS dividend,
              (SELECT coalesce(sum(amount_krw), 0)::text FROM portfolio_income
                WHERE kind = 'interest' AND received_on >= $1 AND received_on < $2) AS interest,
              (SELECT coalesce(sum(tax_withheld_krw), 0)::text FROM portfolio_income
                WHERE received_on >= $1 AND received_on < $2) AS withheld
       FROM t`,
      [from, to, overseasDeductionKrw, overseasTaxPercent],
    );
    const sum = sums.rows[0];
    const years = await pool.query<{ year: number }>(
      `SELECT DISTINCT y::int AS year FROM (
         SELECT extract(year FROM received_on) AS y FROM portfolio_income
         UNION ALL SELECT extract(year FROM traded_on) FROM portfolio_trades WHERE side = 'sell'
         UNION ALL SELECT $1::numeric
       ) x ORDER BY year DESC`,
      [today().slice(0, 4)],
    );
    const dividendKrw = won(sum.dividend);
    const interestKrw = won(sum.interest);
    res.json({
      year,
      years: years.rows.map((row) => row.year),
      income: income.rows.map(toIncome),
      incomeTotals: {
        dividendKrw,
        interestKrw,
        financialIncomeKrw: dividendKrw + interestKrw,
        taxWithheldKrw: won(sum.withheld),
        overLine: dividendKrw + interestKrw > financialIncomeLineKrw,
      },
      gains: {
        overseasKrw: won(sum.overseas),
        domesticKrw: won(sum.domestic),
        sales: sales.rows.map((row) => ({
          tradeId: row.trade_id,
          assetId: row.asset_id,
          assetName: row.asset_name,
          tradedOn: row.traded_on,
          currency: row.currency,
          realizedKrw: won(row.realized_krw),
        })),
      },
      overseasTax: {
        gainKrw: won(sum.overseas),
        deductionKrw: overseasDeductionKrw,
        taxableKrw: won(sum.taxable),
        percent: overseasTaxPercent,
        estimateKrw: won(sum.tax),
      },
    });
  });

  router.post('/', async (req, res) => {
    const body = incomeBody.parse(req.body);
    if (body.receivedOn > today()) {
      throw new HttpError(400, 'Income dated after today cannot be recorded');
    }
    const asset = await pool.query<{ currency: 'KRW' | 'USD' }>(
      'SELECT currency FROM portfolio_assets WHERE id = $1',
      [body.assetId],
    );
    if (!asset.rows[0]) throw new HttpError(404, 'Holding not found');
    const currency = asset.rows[0].currency;
    let amount: string;
    if (currency === 'KRW') {
      if (body.amountKrw === null) throw new HttpError(400, 'Enter the amount in won');
      if (body.amountForeign !== null || body.fxRate !== null) {
        throw new HttpError(400, 'A won holding takes no dollar amount or exchange rate');
      }
      amount = String(body.amountKrw);
    } else {
      if (body.amountForeign === null || body.fxRate === null) {
        throw new HttpError(400, 'Enter the dollar amount and the exchange rate of that day');
      }
      const { rows } = await pool.query<{ amount: string; too_big: boolean }>(
        `SELECT a::text AS amount, a > $3::numeric AS too_big
         FROM (SELECT round($1::numeric * $2::numeric) AS a) x`,
        [body.amountForeign, body.fxRate, MAX_WON],
      );
      if (rows[0].too_big) throw new HttpError(400, `The amount exceeds ${MAX_WON_TEXT}`);
      amount = rows[0].amount;
    }
    if (body.taxWithheldKrw > Number(amount)) {
      throw new HttpError(400, 'The tax withheld cannot be more than the amount');
    }
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO portfolio_income (asset_id, kind, received_on, currency, amount_foreign, fx_rate, amount_krw,
         tax_withheld_krw, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        body.assetId,
        body.kind,
        body.receivedOn,
        currency,
        currency === 'KRW' ? null : body.amountForeign,
        currency === 'KRW' ? null : body.fxRate,
        amount,
        body.taxWithheldKrw,
        body.memo,
      ],
    );
    const { rows } = await pool.query<IncomeRow>(
      `SELECT ${incomeColumns} FROM portfolio_income i JOIN portfolio_assets a ON a.id = i.asset_id WHERE i.id = $1`,
      [inserted.rows[0].id],
    );
    res.status(201).json({ income: toIncome(rows[0]) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'income');
    const deleted = await pool.query('DELETE FROM portfolio_income WHERE id = $1', [id]);
    if (!deleted.rowCount) throw new HttpError(404, 'Income record not found');
    res.status(204).end();
  });

  return router;
}
