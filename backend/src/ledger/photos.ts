import { randomUUID } from 'node:crypto';

import express, { type NextFunction, Router } from 'express';
import type { Pool } from 'pg';

import { HttpError, parseId } from '../standard/http.js';
import type { ObjectStorage } from '../storage.js';
import { PhotoFormatError, sniffPhotoType, stripPhotoMetadata } from './photo-strip.js';

// #300 Receipt photos on an entry. The bytes go to the private object storage (never served from a public URL: every
// view goes through this API behind the sign-in); the table keeps the key. Upload is the raw image body.

/** The largest accepted upload. Phone photos are a few MB; a bigger file is refused instead of stored. */
const maxPhotoBytes = 8 * 1024 * 1024;
export const maxPhotosPerEntry = 5;

type PhotoRow = {
  id: number;
  entry_id: number;
  storage_key: string;
  content_type: string;
  byte_size: number;
  created_at: Date;
};

const present = (row: PhotoRow) => ({
  id: row.id,
  entryId: row.entry_id,
  contentType: row.content_type,
  byteSize: row.byte_size,
  createdAt: row.created_at.toISOString(),
});

const notSetUp = 'Photo storage is not set up on this server';

export function photosRouter(pool: Pool, storage: ObjectStorage | undefined) {
  const router = Router({ mergeParams: true });
  const need = () => {
    if (!storage) throw new HttpError(503, notSetUp);
    return storage;
  };
  const entryOf = async (params: Record<string, string | string[] | undefined>) => {
    const entryId = parseId(params.entryId, 'entry');
    const { rowCount } = await pool.query('SELECT 1 FROM ledger_entries WHERE id = $1', [entryId]);
    if (!rowCount) throw new HttpError(404, 'Entry not found');
    return entryId;
  };

  router.get('/', async (req, res) => {
    const entryId = await entryOf(req.params);
    const { rows } = await pool.query<PhotoRow>(
      'SELECT * FROM ledger_entry_photos WHERE entry_id = $1 ORDER BY id',
      [entryId],
    );
    res.json({ photos: rows.map(present), enabled: storage !== undefined });
  });

  router.post(
    '/',
    // Only image bodies are read; anything else arrives with an empty body and is refused below.
    express.raw({ type: () => true, limit: maxPhotoBytes }),
    async (req, res) => {
      const store = need();
      const entryId = await entryOf(req.params);
      const sent: unknown = req.body;
      if (!(sent instanceof Uint8Array) || sent.length === 0)
        throw new HttpError(400, 'Send a photo');
      // A fresh Buffer of known type: nothing below can see an array or a string.
      const body = Buffer.from(sent);
      if (!sniffPhotoType(body)) throw new HttpError(400, 'Upload a JPEG or PNG photo');
      let clean;
      try {
        clean = stripPhotoMetadata(body);
      } catch (error) {
        if (error instanceof PhotoFormatError) throw new HttpError(400, error.message);
        throw error;
      }
      const { rows: counted } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM ledger_entry_photos WHERE entry_id = $1',
        [entryId],
      );
      if (counted[0].n >= maxPhotosPerEntry) {
        throw new HttpError(409, `An entry holds up to ${maxPhotosPerEntry} photos`);
      }
      const key = `receipts/${entryId}/${randomUUID()}${clean.contentType === 'image/png' ? '.png' : '.jpg'}`;
      await store.put(key, clean.bytes, clean.contentType);
      try {
        const { rows } = await pool.query<PhotoRow>(
          `INSERT INTO ledger_entry_photos (entry_id, storage_key, content_type, byte_size)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [entryId, key, clean.contentType, clean.bytes.length],
        );
        res.status(201).json({ photo: present(rows[0]) });
      } catch (error) {
        await store.delete(key).catch(() => undefined); // the entry was deleted meanwhile, or the insert failed
        if ((error as { code?: string }).code === '23503')
          throw new HttpError(404, 'Entry not found');
        throw error;
      }
    },
  );

  router.get('/:photoId', async (req, res) => {
    const store = need();
    const entryId = parseId((req.params as Record<string, string>).entryId, 'entry');
    const photoId = parseId(req.params.photoId, 'photo');
    const { rows } = await pool.query<PhotoRow>(
      'SELECT * FROM ledger_entry_photos WHERE id = $1 AND entry_id = $2',
      [photoId, entryId],
    );
    const found = rows[0] ? await store.get(rows[0].storage_key) : null;
    if (!rows[0] || !found) throw new HttpError(404, 'Photo not found');
    res.setHeader('Content-Type', rows[0].content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(found.bytes);
  });

  router.delete('/:photoId', async (req, res) => {
    const store = need();
    const entryId = parseId((req.params as Record<string, string>).entryId, 'entry');
    const photoId = parseId(req.params.photoId, 'photo');
    const { rows } = await pool.query<PhotoRow>(
      'DELETE FROM ledger_entry_photos WHERE id = $1 AND entry_id = $2 RETURNING *',
      [photoId, entryId],
    );
    if (!rows[0]) throw new HttpError(404, 'Photo not found');
    await store.delete(rows[0].storage_key);
    res.status(204).end();
  });

  return router;
}

/**
 * Runs before the entry's own DELETE: remembers the entry's stored photos and, once the entry is deleted (204; its
 * photo rows go with it by the foreign key), removes the stored files too. A failed removal is logged, not fatal: the
 * row is already gone, so the orphan is never shown.
 */
export function deleteEntryPhotos(pool: Pool, storage: ObjectStorage | undefined) {
  return async (req: express.Request, res: express.Response, next: NextFunction) => {
    if (!storage || req.method !== 'DELETE' || req.path !== '/') return next();
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return next();
    const { rows } = await pool.query<{ storage_key: string }>(
      'SELECT storage_key FROM ledger_entry_photos WHERE entry_id = $1',
      [id],
    );
    if (rows.length > 0) {
      res.on('finish', () => {
        if (res.statusCode !== 204) return;
        for (const { storage_key: key } of rows) {
          storage.delete(key).catch((error: unknown) => {
            console.error(
              JSON.stringify({
                level: 'error',
                event: 'photo_delete_failed',
                key,
                message: String(error),
              }),
            );
          });
        }
      });
    }
    next();
  };
}
