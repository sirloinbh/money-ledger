import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { exportBackup } from '../src/backup.js';
import { maxPhotosPerEntry } from '../src/ledger/photos.js';
import { memoryStorage } from '../src/storage.js';
import { listen, resetDatabase } from './helpers.js';
import { testDatabase } from './test-database.js';

// #300 Receipt photos against the real database and the in-memory storage. Skipped without TEST_DATABASE_URL.
const url = await testDatabase();

const segment = (marker: number, data: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
};
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe1, Buffer.from('Exif\0\0GPSLatitude=37.5')),
  segment(0xda, Buffer.from([0, 1])),
  Buffer.from([1, 2, 3]),
  Buffer.from([0xff, 0xd9]),
]);

test('receipt photos against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
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

  const storage = memoryStorage();
  const { server, port } = await listen(createApp(pool, { photoStorage: storage }));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${port}`;
  const json = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, init);
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : {} };
  };
  const upload = (entryId: number, body: Buffer) =>
    json(`/api/ledger/entries/${entryId}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array(body),
    });
  const created = await json('/api/ledger/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-11-20', kind: 'expense', amount: 12000, merchant: 'Cafe' }),
  });
  const entryId = created.data.entry.id as number;

  await t.test('attach, list, view and delete a photo, with metadata removed', async () => {
    const up = await upload(entryId, jpeg);
    assert.equal(up.status, 201);
    const photoId = up.data.photo.id as number;
    const stored = await storage.get(storage.keys()[0]);
    assert.ok(
      !stored!.bytes.toString('latin1').includes('GPSLatitude'),
      'the stored file has no GPS',
    );
    const list = await json(`/api/ledger/entries/${entryId}/photos`);
    assert.equal(list.data.photos.length, 1);
    assert.equal(list.data.photos[0].contentType, 'image/jpeg');
    const view = await fetch(`${base}/api/ledger/entries/${entryId}/photos/${photoId}`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'image/jpeg');
    assert.equal(view.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), stored!.bytes);
    // Another entry cannot read it by guessing the id.
    assert.equal((await json(`/api/ledger/entries/${entryId + 1}/photos/${photoId}`)).status, 404);
    const del = await fetch(`${base}/api/ledger/entries/${entryId}/photos/${photoId}`, {
      method: 'DELETE',
    });
    assert.equal(del.status, 204);
    assert.deepEqual(storage.keys(), []);
    assert.equal((await json(`/api/ledger/entries/${entryId}/photos/${photoId}`)).status, 404);
  });

  await t.test('refuses a non-image, an oversized file and a sixth photo', async () => {
    assert.equal((await upload(entryId, Buffer.from('<svg onload=alert(1)>'))).status, 400);
    assert.equal((await upload(entryId, Buffer.alloc(0))).status, 400);
    assert.equal((await upload(entryId, Buffer.alloc(9 * 1024 * 1024, 1))).status, 413);
    assert.equal((await upload(99999, jpeg)).status, 404);
    for (let n = 0; n < maxPhotosPerEntry; n += 1)
      assert.equal((await upload(entryId, jpeg)).status, 201);
    assert.equal((await upload(entryId, jpeg)).status, 409);
    assert.equal(storage.keys().length, maxPhotosPerEntry);
  });

  await t.test('the backup carries the photo files and a restore brings them back', async () => {
    // Deleting one photo leaves the entry's other files alone.
    const first = (await json(`/api/ledger/entries/${entryId}/photos`)).data.photos[0].id;
    await fetch(`${base}/api/ledger/entries/${entryId}/photos/${first}`, { method: 'DELETE' });
    assert.equal(storage.keys().length, maxPhotosPerEntry - 1);
    await upload(entryId, jpeg);
    const backup = await exportBackup(pool, undefined, storage);
    assert.equal(Object.keys(backup.photos ?? {}).length, maxPhotosPerEntry);
    const body = JSON.stringify(backup);
    // Not backed up when storage is off: refused, not silently partial.
    await assert.rejects(exportBackup(pool), /Photo storage is not set up/);
    await json(`/api/ledger/entries/${entryId}`, { method: 'DELETE' });
    assert.deepEqual(storage.keys(), [], 'deleting the entry deletes its files');
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM ledger_entry_photos')).rows[0].n,
      0,
    );
    const restored = await json('/api/backup/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal(storage.keys().length, maxPhotosPerEntry);
    const list = await json(`/api/ledger/entries/${entryId}/photos`);
    assert.equal(list.data.photos.length, maxPhotosPerEntry);
  });

  await t.test('without storage the photo routes answer 503', async () => {
    const off = await listen(createApp(pool));
    try {
      const response = await fetch(
        `http://127.0.0.1:${off.port}/api/ledger/entries/${entryId}/photos/1`,
      );
      assert.equal(response.status, 503);
    } finally {
      await new Promise<void>((resolve) => off.server.close(() => resolve()));
    }
  });
});
