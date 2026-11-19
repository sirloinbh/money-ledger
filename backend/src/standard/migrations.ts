// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// Shared migration runner (#677; rules: project-standards docs/conventions/database.md). Applies
// database/migrations/NNN_<name>.sql in file name order and records each file in schema_migrations. Each file and its
// history row commit in one transaction. The CLI is migrate.ts next to this file.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Client } from 'pg';

export type Migration = { name: string; checksum: string; sql: string };
export type AppliedMigration = { name: string; checksum: string };
/**
 * A single connection, not a Pool: the advisory lock, BEGIN and COMMIT must all run on the same connection, and a
 * Pool may hand each query to a different one.
 */
export type MigrationDb = Pick<Client, 'query'>;

const filePattern = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** Removes a UTF-8 BOM. Editors add one on Windows, and PostgreSQL would read it as part of the first statement. */
function stripBom(sql: string) {
  return sql.replace(/^﻿/, '');
}

// Line endings and a UTF-8 BOM depend on the checkout, not on the migration's meaning.
export function checksum(sql: string) {
  const normalized = stripBom(sql).replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized).digest('hex');
}

/** The SQL without comments and quoted text, so a keyword inside a string or a comment is not mistaken for a statement. */
function code(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const noTransaction: [RegExp, string][] = [
  [/\bCONCURRENTLY\b/i, 'CONCURRENTLY'],
  [/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/im, 'its own transaction control (BEGIN, COMMIT or ROLLBACK)'],
  [/^\s*VACUUM\b/im, 'VACUUM'],
  [/\b(CREATE|DROP)\s+(DATABASE|TABLESPACE)\b/i, 'CREATE or DROP DATABASE or TABLESPACE'],
  [/\bALTER\s+SYSTEM\b/i, 'ALTER SYSTEM'],
];

/**
 * The reason a file cannot run inside the runner's transaction, or undefined. The runner wraps every file in
 * BEGIN/COMMIT, so such a file fails halfway or breaks the history row; it must be applied by hand and recorded.
 */
export function transactionProblem(sql: string) {
  const text = code(sql);
  return noTransaction.find(([pattern]) => pattern.test(text))?.[1];
}

export async function readMigrations(dir: string): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const prefixes = new Map<string, string>();
  const migrations: Migration[] = [];
  for (const name of names) {
    const match = filePattern.exec(name);
    if (!match) throw new Error(`A migration file name must look like NNN_name.sql: ${name}`);
    const previous = prefixes.get(match[1]);
    if (previous) throw new Error(`Two migration files share a number: ${previous}, ${name}`);
    prefixes.set(match[1], name);
    const raw = await readFile(join(dir, name), 'utf8');
    const problem = transactionProblem(raw);
    if (problem) {
      throw new Error(`${name} cannot run in the runner's transaction because it uses ${problem}`);
    }
    migrations.push({ name, checksum: checksum(raw), sql: stripBom(raw) });
  }
  return migrations;
}

// History is append-only: an applied file must still exist unchanged, and a new
// file must sort after every applied one so all databases share one order.
export function planMigrations(files: Migration[], applied: AppliedMigration[]) {
  const errors: string[] = [];
  const byName = new Map(files.map((file) => [file.name, file]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (!file) errors.push(`An applied migration file is missing: ${row.name}`);
    else if (file.checksum !== row.checksum) errors.push(`An applied migration file was changed: ${row.name}`);
  }
  const done = new Set(applied.map((row) => row.name));
  const last = applied
    .map((row) => row.name)
    .sort()
    .at(-1);
  const pending = files.filter((file) => !done.has(file.name));
  for (const file of pending) {
    if (last && file.name < last) errors.push(`A new file sorts before the applied ${last}: ${file.name}`);
  }
  return { pending, errors };
}

// Read-only: a database without history reports every file as pending.
export async function migrationStatus(db: MigrationDb, files: Migration[]) {
  const exists = (await db.query(`SELECT to_regclass('schema_migrations') IS NOT NULL AS found`)).rows[0].found as boolean;
  const applied = exists
    ? ((await db.query('SELECT name, checksum FROM schema_migrations ORDER BY name')).rows as AppliedMigration[])
    : [];
  return { applied, ...planMigrations(files, applied) };
}

// Each file and its history row commit together; a failure rolls back that file
// only and stops, leaving earlier files recorded. `lockKey` is the app's advisory lock key (the migrate.ts entry
// derives it from the registry slot), so concurrent runners (CI, host CLI, deploy) apply files one at a time.
export async function migrate(db: MigrationDb, files: Migration[], lockKey: number) {
  await db.query('SELECT pg_advisory_lock($1)', [lockKey]);
  let applied: string[];
  try {
    applied = await applyPending(db, files);
  } catch (e) {
    // A lost connection fails the unlock too (the server drops the lock with the session);
    // keep the original error, which names the file and the cause (#414).
    await unlock(db, lockKey).catch(() => undefined);
    throw e;
  }
  await unlock(db, lockKey);
  return applied;
}

async function applyPending(db: MigrationDb, files: Migration[]) {
  await ensureHistory(db);
  const { pending, errors } = await migrationStatus(db, files);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const file of pending) {
    await db.query('BEGIN');
    try {
      await db.query(file.sql);
      await db.query('INSERT INTO schema_migrations(name, checksum) VALUES($1, $2)', [file.name, file.checksum]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw new Error(`${file.name} failed to apply: ${(e as Error).message}`, { cause: e });
    }
  }
  return pending.map((file) => file.name);
}

function unlock(db: MigrationDb, lockKey: number) {
  return db.query('SELECT pg_advisory_unlock($1)', [lockKey]);
}

function ensureHistory(db: MigrationDb) {
  return db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}
