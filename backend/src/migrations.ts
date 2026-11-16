// #71 Shared migration runner (central rules: project-standards docs/conventions/database.md, scaffold
// app/backend/src/migrations.ts; the English text follows study-log). Applies database/migrations/NNN_<name>.sql in
// file name order and records each file in schema_migrations.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PoolClient } from 'pg';

export type Migration = { name: string; checksum: string; sql: string };
export type AppliedMigration = { name: string; checksum: string };
type Db = Pick<PoolClient, 'query'>;

const filePattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
// Fixed key so concurrent runners (a deploy and the host CLI) apply files one at a time.
const lockKey = 581_005;

// Line endings and a UTF-8 BOM depend on the checkout, not on the migration's meaning.
export function checksum(sql: string) {
  const withoutBom = sql.startsWith(String.fromCharCode(0xfeff)) ? sql.slice(1) : sql;
  const normalized = withoutBom.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export async function readMigrations(dir: string): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const prefixes = new Map<string, string>();
  const migrations: Migration[] = [];
  for (const name of names) {
    const match = filePattern.exec(name);
    if (!match) throw new Error(`Migration file names must look like NNN_name.sql: ${name}`);
    const previous = prefixes.get(match[1]);
    if (previous) throw new Error(`Duplicate migration number: ${previous}, ${name}`);
    prefixes.set(match[1], name);
    const sql = await readFile(join(dir, name), 'utf8');
    migrations.push({ name, checksum: checksum(sql), sql });
  }
  return migrations;
}

// History is append-only: an applied file must still exist unchanged, and a new file must sort after
// every applied one so all databases share one order.
export function planMigrations(files: Migration[], applied: AppliedMigration[]) {
  const errors: string[] = [];
  const byName = new Map(files.map((file) => [file.name, file]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (!file) errors.push(`Applied migration file is missing: ${row.name}`);
    else if (file.checksum !== row.checksum)
      errors.push(`Applied migration file was changed: ${row.name}`);
  }
  const done = new Set(applied.map((row) => row.name));
  const last = applied
    .map((row) => row.name)
    .sort()
    .at(-1);
  const pending = files.filter((file) => !done.has(file.name));
  for (const file of pending)
    if (last && file.name < last)
      errors.push(`New file numbered before the already applied ${last}: ${file.name}`);
  return { pending, errors };
}

// Each file and its history row commit together; a failure rolls back that file only and stops,
// leaving earlier files recorded. A database set up before this history existed runs every file
// once more, which is safe because migrations are written to be rerun (database/README.md).
export async function migrate(db: Db, files: Migration[]) {
  await db.query('SELECT pg_advisory_lock($1)', [lockKey]);
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
    const applied = (await db.query('SELECT name, checksum FROM schema_migrations ORDER BY name'))
      .rows as AppliedMigration[];
    const { pending, errors } = planMigrations(files, applied);
    if (errors.length) throw new Error(errors.join('\n'));
    for (const file of pending) {
      await db.query('BEGIN');
      try {
        await db.query(file.sql);
        await db.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file.name,
          file.checksum,
        ]);
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Failed to apply ${file.name}: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    return pending.map((file) => file.name);
  } finally {
    // After a lost connection this fails too; the lock went with the session, and the error that
    // matters is the one already on its way.
    await db.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
  }
}
