import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON, MAX_WON_TEXT } from '../contract.js';
import { won } from '../money.js';

// #296 Estimate of the year-end tax "card deduction" (신용카드 등 사용금액 소득공제).
// An ESTIMATE only. Rules used (sources and the date they were checked: docs/card-deduction.md):
//   - the threshold is 25% of the total salary: spending up to it earns no deduction;
//   - credit card spending past it is deducted at 15%, debit card and cash receipts at 30%;
//   - the threshold is used up by credit card spending first, then by debit card and cash;
//   - the deduction is capped by the salary band.
// Not modeled: the higher rates and extra limits for traditional markets, public transport, culture and books,
// the extra limit for children, and spending that does not count (tax, insurance, tuition, rent, ...).
// Entries without a payment method are shown apart and are left out of the estimate.

const cardRules = {
  thresholdPercent: 25n,
  creditPercent: 15n,
  debitCashPercent: 30n,
  // Base limit by total salary: up to 70 million won, up to 120 million won, above.
  limits: [
    { upTo: 70_000_000n, limit: 3_000_000n },
    { upTo: 120_000_000n, limit: 2_500_000n },
    { upTo: null, limit: 2_000_000n },
  ],
} as const;

export type CardDeductionInput = {
  salary: number;
  credit: number;
  debit: number;
  cash: number;
};

export type CardDeduction = {
  threshold: number;
  /** Credit + debit + cash spending. */
  counted: number;
  /** Spending past the threshold (0 while under it). */
  overThreshold: number;
  /** Spending still needed to reach the threshold (0 once past it). */
  toThreshold: number;
  /** The estimated deduction after the limit. */
  deduction: number;
  /** The deduction before the limit. */
  beforeLimit: number;
  limit: number;
};

/** Whole-won arithmetic on bigint, so no amount is ever rounded through a float. Each rate rounds down. */
export function estimateCardDeduction({
  salary,
  credit,
  debit,
  cash,
}: CardDeductionInput): CardDeduction {
  const total = BigInt(salary);
  const c = BigInt(credit);
  const d = BigInt(debit) + BigInt(cash);
  const threshold = (total * cardRules.thresholdPercent) / 100n;
  let beforeLimit: bigint;
  if (c >= threshold) {
    beforeLimit =
      ((c - threshold) * cardRules.creditPercent) / 100n + (d * cardRules.debitCashPercent) / 100n;
  } else {
    const left = d - (threshold - c);
    beforeLimit = left > 0n ? (left * cardRules.debitCashPercent) / 100n : 0n;
  }
  const limit = cardRules.limits.find((band) => band.upTo === null || total <= band.upTo)!.limit;
  const counted = c + d;
  return {
    threshold: Number(threshold),
    counted: Number(counted),
    overThreshold: Number(counted > threshold ? counted - threshold : 0n),
    toThreshold: Number(counted < threshold ? threshold - counted : 0n),
    deduction: Number(beforeLimit < limit ? beforeLimit : limit),
    beforeLimit: Number(beforeLimit),
    limit: Number(limit),
  };
}

export const yearQuery = z.object(
  {
    year: z
      .string()
      .regex(/^(20\d{2})$/, 'The year is not valid')
      .optional(),
  },
  { error: 'The query is not valid' },
);

export const salaryBody = z.object(
  {
    year: z
      .number({ error: 'Enter the year as a number' })
      .int()
      .min(2000, 'The year is not valid')
      .max(2100, 'The year is not valid'),
    totalSalary: z
      .number({ error: 'Enter the total salary as a number' })
      .max(MAX_WON, { error: `Enter a salary of ${MAX_WON_TEXT} or less`, abort: true })
      .int('Enter the total salary as a whole number of won')
      .min(0, 'The salary must be ₩0 or more'),
  },
  { error: 'The request body must be a JSON object' },
);

type Methods = Record<'credit_card' | 'debit_card' | 'cash' | 'unknown', number>;

async function cardDeductionFor(db: Pick<Pool, 'query'>, year: number) {
  const [spent, salary] = await Promise.all([
    db.query<{ payment_method: string | null; total: string }>(
      `SELECT payment_method, sum(amount)::text AS total FROM ledger_entries
       WHERE kind = 'expense' AND entry_date >= make_date($1, 1, 1) AND entry_date < make_date($1 + 1, 1, 1)
       GROUP BY payment_method`,
      [year],
    ),
    db.query<{ total_salary: string }>(
      'SELECT total_salary FROM ledger_tax_salaries WHERE tax_year = $1',
      [year],
    ),
  ]);
  const totals: Methods = { credit_card: 0, debit_card: 0, cash: 0, unknown: 0 };
  for (const row of spent.rows)
    totals[(row.payment_method ?? 'unknown') as keyof Methods] = won(row.total);
  const totalSalary = salary.rows[0] ? won(salary.rows[0].total_salary) : null;
  return {
    year,
    totalSalary,
    spending: {
      creditCard: totals.credit_card,
      debitCard: totals.debit_card,
      cash: totals.cash,
      unknown: totals.unknown,
    },
    // Null until a salary is entered: the threshold depends on it.
    estimate:
      totalSalary === null
        ? null
        : estimateCardDeduction({
            salary: totalSalary,
            credit: totals.credit_card,
            debit: totals.debit_card,
            cash: totals.cash,
          }),
    rules: {
      thresholdPercent: Number(cardRules.thresholdPercent),
      creditPercent: Number(cardRules.creditPercent),
      debitCashPercent: Number(cardRules.debitCashPercent),
    },
  };
}

export function cardDeductionRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();

  router.get('/card-deduction', async (req, res) => {
    const query = yearQuery.parse(req.query);
    res.json(
      await cardDeductionFor(pool, query.year ? Number(query.year) : Number(today().slice(0, 4))),
    );
  });

  router.put('/salary', async (req, res) => {
    const body = salaryBody.parse(req.body);
    await pool.query(
      `INSERT INTO ledger_tax_salaries (tax_year, total_salary) VALUES ($1, $2)
       ON CONFLICT (tax_year) DO UPDATE SET total_salary = EXCLUDED.total_salary, updated_at = now()`,
      [body.year, body.totalSalary],
    );
    res.json(await cardDeductionFor(pool, body.year));
  });

  return router;
}
