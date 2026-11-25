import assert from 'node:assert/strict';
import { test } from 'node:test';

import express from 'express';
import { Pool } from 'pg';

import { cardImportRouter } from '../src/ledger/card-import.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

// The file reader is replaced by JSON here: the sheet logic is what this file tests.
const readSheet = (file: Buffer) => JSON.parse(file.toString('utf8')) as string[][];
const row = (when: string, approval: string, shop: string, amount: string, cancel = '') => [
  when,
  approval,
  '9876',
  shop,
  '1234567890',
  '일시불',
  '',
  amount,
  cancel,
  '2026.02.10',
];
const sheet = (...rows: string[][]) => [['(2026.01.01 ~ 2026.01.31)'], ['h'], ...rows];

async function start(pool: Pool, t: { after: (fn: () => Promise<void>) => void }) {
  const app = express();
  app.use('/card', cardImportRouter(pool, { readSheet }));
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise<void>((resolve) => void server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  return async (path: string, body: string, query = 'kind=domestic') => {
    const response = await fetch(`http://127.0.0.1:${port}/card/${path}?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };
}

test('card import saves, updates and removes entries by approval number', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await pool.query('TRUNCATE ledger_entries RESTART IDENTITY CASCADE');
  const send = await start(pool, t);
  const entries = async () =>
    (
      await pool.query<{ line: string }>(
        `SELECT concat_ws(' ', entry_date, amount, merchant, source_card, source_ref, memo) AS line
         FROM ledger_entries ORDER BY id`,
      )
    ).rows.map((r) => r.line.trim());

  const first = JSON.stringify(
    sheet(
      row('01.05 10:00:00', '111', '스타벅스', '4,500'),
      row('01.06 10:00:00', '222', '식당', '20,000'),
      row('01.07 10:00:00', '333', '취소건', '5,000', '5,000'),
    ),
  );
  const preview = await send('preview', first);
  assert.equal(preview.status, 200);
  assert.deepEqual(
    (preview.data.rows as { action: string }[]).map((r) => r.action),
    ['new', 'new', 'skipped'],
  );
  assert.deepEqual(await entries(), [], 'a preview saves nothing');

  assert.deepEqual((await send('import', first)).data, {
    added: 2,
    updated: 0,
    removed: 0,
    unchanged: 0,
    skipped: 1,
  });
  assert.deepEqual(await entries(), ['2026-01-05 4500 스타벅스 9876 111', '2026-01-06 20000 식당 9876 222']);

  // The same file again adds nothing.
  assert.deepEqual((await send('import', first)).data, {
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 2,
    skipped: 1,
  });

  // A newer file: 111 is partly cancelled, 222 is fully cancelled.
  const second = JSON.stringify(
    sheet(
      row('01.05 10:00:00', '111', '스타벅스', '4,500', '1,000'),
      row('01.06 10:00:00', '222', '식당', '20,000', '20,000'),
    ),
  );
  assert.deepEqual((await send('import', second)).data, {
    added: 0,
    updated: 1,
    removed: 1,
    unchanged: 0,
    skipped: 0,
  });
  assert.deepEqual(await entries(), ['2026-01-05 3500 스타벅스 9876 111']);
});

test('a hand-entered expense with the same date and amount is a duplicate candidate', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await pool.query('TRUNCATE ledger_entries RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO ledger_entries (entry_date, kind, amount, merchant) VALUES ('2026-01-05', 'expense', 4500, '커피')`,
  );
  const send = await start(pool, t);
  const file = JSON.stringify(sheet(row('01.05 10:00:00', '111', '스타벅스', '4,500')));
  const preview = await send('preview', file);
  assert.equal((preview.data.rows as { candidate: boolean }[])[0].candidate, true);
  assert.equal((await send('import', file)).data.skipped, 1);
  assert.equal((await send('import', file, 'kind=domestic&skipCandidates=false')).data.added, 1);
  assert.equal((await pool.query('SELECT 1 FROM ledger_entries')).rowCount, 2);
});

test('bad requests are refused with a message', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const send = await start(pool, t);
  assert.equal((await send('import', '')).status, 422);
  assert.equal((await send('import', '[]', 'kind=other')).status, 422);
  assert.equal((await send('import', 'not json')).status, 422);
  assert.equal((await send('import', JSON.stringify([['x']]))).status, 422);
});
