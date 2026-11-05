import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from './standard/http.js';

// #50 Mock trading account: virtual won kept apart from the ledger and the portfolio.
// One open account at a time. Resetting closes it and opens a new one in one transaction; closed accounts
// are kept (2026-11-03 decision). Orders, holdings and returns come with #52-#54.

const defaultInitialCashKrw = 10_000_000;
const shownClosedAccounts = 20;

const accountBody = z.object(
  {
    initialCashKrw: z
      .number({ error: '시작 금액을 숫자로 입력하세요' })
      .int('시작 금액은 원 단위 정수로 입력하세요')
      .min(10_000, '시작 금액은 1만 원 이상이어야 합니다')
      .max(10_000_000_000, '시작 금액은 100억 원 이하로 입력하세요')
      .default(defaultInitialCashKrw),
  },
  { error: '요청 본문은 JSON 객체여야 합니다' },
);

type Row = {
  id: string;
  initial_cash_krw: string;
  cash_krw: string;
  created_at: Date;
  closed_at: Date | null;
};

const columns = 'id, initial_cash_krw, cash_krw, created_at, closed_at';

const toAccount = (row: Row) => ({
  id: Number(row.id),
  // Both are bigint within the CHECK ranges of 005, so they are exact as JSON numbers.
  initialCashKrw: Number(row.initial_cash_krw),
  cashKrw: Number(row.cash_krw),
  createdAt: row.created_at.toISOString(),
  closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
});

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

export function mockAccountsRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (_req, res) => {
    // One statement, so the open account and the closed ones come from the same snapshot even while a
    // reset commits in between.
    const { rows } = await pool.query<Row>(
      `SELECT ${columns} FROM mock_accounts
       WHERE closed_at IS NULL
          OR id IN (SELECT id FROM mock_accounts WHERE closed_at IS NOT NULL
                    ORDER BY closed_at DESC, id DESC LIMIT ${shownClosedAccounts})
       ORDER BY closed_at DESC NULLS FIRST, id DESC`,
    );
    const open = rows.find((row) => row.closed_at === null);
    res.json({
      account: open ? toAccount(open) : null,
      closedAccounts: rows.filter((row) => row.closed_at !== null).map(toAccount),
    });
  });

  router.post('/', async (req, res) => {
    const body = accountBody.parse(req.body);
    try {
      const { rows } = await pool.query<Row>(
        `INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES ($1, $1) RETURNING ${columns}`,
        [body.initialCashKrw],
      );
      res.status(201).json({ account: toAccount(rows[0]) });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, '이미 모의투자 계좌가 있습니다');
      throw error;
    }
  });

  // The id names the account the screen showed, so a second click or a stale tab cannot close the new one.
  router.post('/:id/reset', async (req, res) => {
    const id = parseId(req.params.id, '모의투자 계좌');
    const body = accountBody.parse(req.body);
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const closed = await client.query(
        'UPDATE mock_accounts SET closed_at = now() WHERE id = $1 AND closed_at IS NULL RETURNING id',
        [id],
      );
      if (!closed.rowCount) {
        const exists = await client.query('SELECT 1 FROM mock_accounts WHERE id = $1', [id]);
        throw exists.rowCount
          ? new HttpError(409, '이미 초기화된 계좌입니다. 화면을 새로 고친 뒤 다시 시도하세요')
          : new HttpError(404, '모의투자 계좌를 찾을 수 없습니다');
      }
      const { rows } = await client.query<Row>(
        `INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES ($1, $1) RETURNING ${columns}`,
        [body.initialCashKrw],
      );
      await client.query('COMMIT');
      res.json({ account: toAccount(rows[0]) });
    } catch (error) {
      // A connection that cannot even roll back is dropped instead of going back to the pool.
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw error;
    } finally {
      client.release(broken);
    }
  });

  return router;
}
