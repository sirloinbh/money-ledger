import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { cardImportRouter } from '../src/ledger/card-import.js';
import { maxPhotosPerEntry } from '../src/ledger/photos.js';
import { memoryStorage, type ObjectStorage } from '../src/storage.js';
import { listen, resetDatabase } from './helpers.js';
import { testDatabase } from './test-database.js';

// #374 Receipt photo files are removed with their rows on every path, and the limit holds under parallel uploads.
const url = await testDatabase();

const segment = (marker: number, data: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
};
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xda, Buffer.from([0, 1])),
  Buffer.from([1, 2, 3]),
  Buffer.from([0xff, 0xd9]),
]);

async function setUp(pool: Pool) {
  await resetDatabase(pool);
  const names = (
    await readdir(fileURLToPath(new URL('../../database/migrations/', import.meta.url)))
  )
    .filter((name) => name.endsWith('.sql'))
    .sort();
  await pool.query(
    'CREATE TABLE schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  await pool.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, 'test')", [
    names.at(-1),
  ]);
}

async function entryWithPhoto(pool: Pool, storage: ObjectStorage, ref: string) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO ledger_entries (entry_date, kind, amount, merchant, source, source_card, source_ref)
     VALUES ('2026-01-05', 'expense', 1000, 'Shop', 'woori-card', '9876', $1) RETURNING id`,
    [ref],
  );
  const key = `receipts/${rows[0].id}/${ref}.png`;
  await storage.put(key, Buffer.from('x'), 'image/png');
  await pool.query(
    "INSERT INTO ledger_entry_photos (entry_id, storage_key, content_type, byte_size) VALUES ($1, $2, 'image/png', 1)",
    [rows[0].id, key],
  );
  return { id: rows[0].id, key };
}

test('a card import that removes an entry removes its photo files', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await setUp(pool);
  const storage = memoryStorage();
  const gone = await entryWithPhoto(pool, storage, '111');
  const kept = await entryWithPhoto(pool, storage, '222');
  const app = express();
  app.use(
    '/card',
    cardImportRouter(pool, {
      readSheet: (file) => JSON.parse(file.toString('utf8')) as string[][],
      storage,
    }),
  );
  const { server, port } = await listen(app as ReturnType<typeof createApp>);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  // 111 is fully cancelled (removed); 222 is unchanged.
  const row = (approval: string, cancel: string) => [
    '01.05 10:00:00',
    approval,
    '9876',
    'Shop',
    '1',
    '일시불',
    '',
    '1,000',
    cancel,
    '2026.02.10',
  ];
  const sheet = [['(2026.01.01 ~ 2026.01.31)'], ['h'], row('111', '1,000'), row('222', '')];
  const response = await fetch(`http://127.0.0.1:${port}/card/import?kind=domestic`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: JSON.stringify(sheet),
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { removed: number }).removed, 1);
  assert.deepEqual(storage.keys(), [kept.key]);
  assert.notEqual(gone.key, kept.key);
});

test(
  'a failing storage delete does not turn a deleted photo into a 500',
  { skip: !url },
  async (t) => {
    const pool = new Pool({ connectionString: url });
    t.after(() => pool.end());
    await setUp(pool);
    const memory = memoryStorage();
    const storage: ObjectStorage = {
      ...memory,
      delete: () => Promise.reject(new Error('storage is down')),
    };
    const photo = await entryWithPhoto(pool, storage, '111');
    const { rows } = await pool.query<{ id: number }>('SELECT id FROM ledger_entry_photos');
    const { server, port } = await listen(createApp(pool, { photoStorage: storage }));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const response = await fetch(
      `http://127.0.0.1:${port}/api/ledger/entries/${photo.id}/photos/${rows[0].id}`,
      { method: 'DELETE' },
    );
    assert.equal(response.status, 204);
    assert.equal((await pool.query('SELECT 1 FROM ledger_entry_photos')).rowCount, 0);
  },
);

test('parallel uploads cannot pass the photo limit', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await setUp(pool);
  const storage = memoryStorage();
  const entry = await entryWithPhoto(pool, storage, '111');
  for (let n = 1; n < maxPhotosPerEntry - 1; n += 1) {
    await pool.query(
      "INSERT INTO ledger_entry_photos (entry_id, storage_key, content_type, byte_size) VALUES ($1, $2, 'image/png', 1)",
      [entry.id, `receipts/${entry.id}/seed${n}.png`],
    );
  }
  const { server, port } = await listen(createApp(pool, { photoStorage: storage }));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const upload = () =>
    fetch(`http://127.0.0.1:${port}/api/ledger/entries/${entry.id}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array(jpeg),
    });
  const answers = await Promise.all([upload(), upload(), upload(), upload()]);
  const statuses = answers.map((a) => a.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409], 'one slot was left, so one upload wins');
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM ledger_entry_photos')).rows[0].n,
    maxPhotosPerEntry,
  );
  assert.equal(storage.keys().length, 2, 'the refused uploads left no file behind');
});
