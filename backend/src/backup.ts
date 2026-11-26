import express, { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { sniffPhotoType } from './ledger/photo-strip.js';
import { HttpError } from './standard/http.js';
import type { ObjectStorage } from './storage.js';

// #298 Back up and restore all data. One versioned JSON file holds every user table; it is built in one read-only
// REPEATABLE READ transaction (one consistent snapshot), and restore runs in one transaction that either restores
// everything or nothing. The tables come from the schema (information_schema), and every table must be listed in
// one of the three groups below: a table a later change adds fails the backup (and its test) until it is classified,
// so it can never be left out silently.

const backupApp = 'money-ledger';
export const backupFormat = 1;

/**
 * Data a person entered, plus what grows from it. A restore only goes into a database where all of these are empty
 * (decision pending with the user, #298: the recommendation is "empty database only"; see docs/changes/298).
 */
const enteredTables = [
  'app_settings',
  'budget_alerts_sent',
  'ledger_budgets',
  'ledger_category_rules',
  'ledger_entries',
  'ledger_fixed_cost_runs',
  'ledger_fixed_costs',
  'ledger_entry_photos',
  'ledger_entry_splits',
  'ledger_recurring_dismissals',
  'ledger_tax_salaries',
  'mock_accounts',
  'mock_cash_flows',
  'mock_holdings',
  'mock_orders',
  'mock_position_questions',
  'mock_positions',
  'mock_snapshots',
  'portfolio_assets',
  'portfolio_income',
  'portfolio_prepaid_usages',
  'portfolio_trades',
  'savings_goals',
] as const;

/**
 * Seeded by migrations or written by the app on its own (prices, rates, news, logs, the daily net worth and report
 * saves, the daily pick). They are in the backup too, but a restore clears them first, because a freshly migrated
 * database already holds some rows (the default categories, the market calendar) and opening the app once saves
 * today's net worth and the finished reports: an app that was only opened is still an empty database.
 */
const replaceableTables = [
  'audit_log',
  'base_rates',
  'daily_picks',
  'fx_rates',
  'kakao_commands',
  'krx_holiday_sync',
  'krx_holidays',
  'krx_market_days',
  'ledger_categories',
  'net_worth_snapshots',
  'news_items',
  'price_api_calls',
  'price_fetch_state',
  'securities',
  'security_prices',
  'spending_report_changes',
  'spending_reports',
] as const;

/**
 * Never in the file. schema_migrations is the migration runner's own history; the Kakao tables hold the encrypted
 * sign-in tokens and login states (secrets), which a backup must not carry (#298: keep secrets out of the file).
 */
export const excludedTables = [
  'kakao_connection',
  'kakao_login_states',
  'schema_migrations',
] as const;

const entered = new Set<string>(enteredTables);
const replaceable = new Set<string>(replaceableTables);
const excluded = new Set<string>(excludedTables);
const backedUp = (name: string) => entered.has(name) || replaceable.has(name);

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** Rows per INSERT when restoring. */
const chunk = 1000;
/** The restore body limit: a personal ledger is a few megabytes; this leaves room for years of data. */
const restoreLimit = '400mb';

type Column = { name: string; type: string; identity: boolean };

async function userTables(db: Pool | PoolClient) {
  const { rows } = await db.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return rows.map((row) => row.name);
}

/** The tables in the database that no group lists. Empty when the rules are complete. */
export async function unclassifiedTables(db: Pool | PoolClient) {
  return (await userTables(db)).filter((name) => !backedUp(name) && !excluded.has(name));
}

async function refuseUnclassified(db: Pool | PoolClient) {
  const missing = await unclassifiedTables(db);
  if (missing.length > 0) {
    throw new Error(
      `These tables are not in the backup rules (backend/src/backup.ts): ${missing.join(', ')}`,
    );
  }
}

async function columnsOf(db: Pool | PoolClient, table: string) {
  const { rows } = await db.query<{ name: string; type: string; identity: string | null }>(
    `SELECT column_name AS name, data_type AS type, identity_generation AS identity
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row): Column => ({
    name: row.name,
    type: row.type,
    identity: row.identity !== null,
  }));
}

/** The tables of `names` with every parent before its children (foreign keys), so rows can be inserted in order. */
async function inForeignKeyOrder(db: Pool | PoolClient, names: string[]) {
  const { rows } = await db.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const wanted = new Set(names);
  const parents = new Map<string, Set<string>>(names.map((name) => [name, new Set()]));
  for (const { child, parent } of rows) {
    if (child !== parent && wanted.has(child) && wanted.has(parent))
      parents.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < names.length) {
    const ready = names.filter(
      (name) => !done.has(name) && [...parents.get(name)!].every((p) => done.has(p)),
    );
    if (ready.length === 0)
      throw new Error('The foreign keys between the backed-up tables form a cycle');
    for (const name of ready) {
      done.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

async function primaryKey(db: Pool | PoolClient, table: string) {
  const { rows } = await db.query<{ name: string }>(
    `SELECT a.attname AS name FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [`public.${quote(table)}`],
  );
  return rows.map((row) => row.name);
}

async function latestMigration(db: Pool | PoolClient) {
  const { rows } = await db.query<{ name: string }>(
    'SELECT max(name) AS name FROM schema_migrations',
  );
  return rows[0]?.name ?? null;
}

export type Backup = {
  app: typeof backupApp;
  format: typeof backupFormat;
  createdAt: string;
  /** The newest migration of the database the file came from: a restore refuses a file from a newer schema. */
  schemaMigration: string | null;
  tables: Record<string, Record<string, unknown>[]>;
  /** #300 The receipt photo files, by storage key (base64), so the backup holds the images and not only their rows. */
  photos?: Record<string, { contentType: string; data: string }>;
};

/**
 * Every backed-up table as JSON rows, read in one REPEATABLE READ READ ONLY transaction, so the file is one point in
 * time even while the app writes. Numbers that could lose digits in JSON (numeric, bigint) travel as text.
 */
export async function exportBackup(
  pool: Pool,
  now: () => Date = () => new Date(),
  storage?: ObjectStorage,
): Promise<Backup> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await refuseUnclassified(client);
    const names = (await userTables(client)).filter(backedUp);
    const tables: Backup['tables'] = {};
    for (const name of names) {
      const columns = await columnsOf(client, name);
      const select = columns
        .map((column) =>
          column.type === 'numeric' || column.type === 'bigint'
            ? `${quote(column.name)}::text AS ${quote(column.name)}`
            : quote(column.name),
        )
        .join(', ');
      const order = (await primaryKey(client, name)).map(quote).join(', ');
      const { rows } = await client.query<{ row: Record<string, unknown> }>(
        `SELECT row_to_json(t) AS row FROM (SELECT ${select} FROM public.${quote(name)}${order ? ` ORDER BY ${order}` : ''}) t`,
      );
      tables[name] = rows.map((row) => row.row);
    }
    const schemaMigration = await latestMigration(client);
    await client.query('COMMIT');
    const photoRows = tables.ledger_entry_photos ?? [];
    const backup: Backup = {
      app: backupApp,
      format: backupFormat,
      createdAt: now().toISOString(),
      schemaMigration,
      tables,
    };
    if (photoRows.length > 0) {
      // A backup that silently lacked its photos would look complete: refuse instead.
      if (!storage)
        throw new HttpError(503, 'Photo storage is not set up, so the photos cannot be backed up');
      backup.photos = {};
      for (const row of photoRows) {
        const key = String(row.storage_key);
        const found = await storage.get(key);
        if (!found)
          throw new HttpError(500, `A stored photo is missing (${key}); the backup was not made`);
        backup.photos[key] = {
          contentType: found.contentType,
          data: found.bytes.toString('base64'),
        };
      }
    }
    return backup;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const restoreBody = z.object(
  {
    app: z.literal(backupApp, { error: 'This is not a Money Ledger backup file' }),
    format: z.number({ error: 'The backup file has no version' }),
    createdAt: z.string({ error: 'The backup file has no creation time' }),
    schemaMigration: z.string().nullable(),
    photos: z
      .record(z.string(), z.object({ contentType: z.string(), data: z.string() }))
      .optional(),
    tables: z.record(
      z.string(),
      z.array(z.record(z.string(), z.unknown()), { error: 'Each table must be a list of rows' }),
      {
        error: 'The backup file has no tables',
      },
    ),
  },
  { error: 'The request body must be a Money Ledger backup file' },
);

export type RestoreResult = { restored: Record<string, number>; total: number };

/**
 * Puts a backup into an empty database, in one transaction: any refusal or failure leaves the database untouched.
 * "Empty" means every entered table has no rows; the seeded and job-filled tables are cleared and replaced by the
 * file's rows. Refuses (409) a database that has data and a file from a newer schema, and (422) a file with an
 * unknown or secret table, an unknown column, or rows the database rejects.
 */
async function restoreBackup(
  pool: Pool,
  input: z.infer<typeof restoreBody>,
  storage?: ObjectStorage,
): Promise<RestoreResult> {
  if (input.format !== backupFormat) {
    throw new HttpError(
      422,
      `Unsupported backup version ${input.format}. This app reads version ${backupFormat}`,
    );
  }
  for (const name of Object.keys(input.tables)) {
    if (excluded.has(name))
      throw new HttpError(422, `The backup must not contain the table ${name}`);
    if (!backedUp(name))
      throw new HttpError(422, `The backup has a table this app does not know: ${name}`);
  }
  const photoRows = input.tables.ledger_entry_photos ?? [];
  const photoFiles = new Map<string, Buffer>();
  for (const row of photoRows) {
    const key = String(row.storage_key);
    const file = input.photos?.[key];
    if (!file) throw new HttpError(422, `The backup has a photo row without its file (${key})`);
    const bytes = Buffer.from(file.data, 'base64');
    if (sniffPhotoType(bytes) !== file.contentType)
      throw new HttpError(422, `The photo file ${key} is not a JPEG or PNG image`);
    photoFiles.set(key, bytes);
  }
  if (photoFiles.size > 0 && !storage)
    throw new HttpError(503, 'Photo storage is not set up, so the photos cannot be restored');
  const written: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await refuseUnclassified(client);
    const names = (await userTables(client)).filter(backedUp);
    // No other write can slip in between the emptiness check and the inserts. DISABLE TRIGGER needs it too.
    await client.query(
      `LOCK TABLE ${names.map((name) => `public.${quote(name)}`).join(', ')} IN ACCESS EXCLUSIVE MODE`,
    );

    const current = await latestMigration(client);
    if (input.schemaMigration !== null && (current === null || input.schemaMigration > current)) {
      throw new HttpError(
        409,
        `The backup comes from a newer version of the app (${input.schemaMigration}). Update the app first`,
      );
    }
    const filled: string[] = [];
    for (const name of names.filter((table) => entered.has(table))) {
      const { rows } = await client.query<{ found: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM public.${quote(name)}) AS found`,
      );
      if (rows[0].found) filled.push(name);
    }
    if (filled.length > 0) {
      throw new HttpError(
        409,
        `The database already has data (${filled.join(', ')}). A backup is restored only into an empty database`,
      );
    }

    const ordered = await inForeignKeyOrder(client, names);
    // The restored rows were valid where they came from: the report-change log and the prepaid balance check must
    // not run again (the log would add rows the file already has).
    for (const name of ordered)
      await client.query(`ALTER TABLE public.${quote(name)} DISABLE TRIGGER USER`);
    for (const name of [...ordered].reverse().filter((table) => replaceable.has(table))) {
      await client.query(`DELETE FROM public.${quote(name)}`);
    }

    const restored: Record<string, number> = {};
    for (const name of ordered) {
      const rows = input.tables[name];
      if (rows === undefined) continue;
      const columns = await columnsOf(client, name);
      const known = new Set(columns.map((column) => column.name));
      for (const row of rows) {
        const unknown = Object.keys(row).find((key) => !known.has(key));
        if (unknown !== undefined) {
          throw new HttpError(
            422,
            `The table ${name} has a column this database does not have: ${unknown}`,
          );
        }
      }
      for (let start = 0; start < rows.length; start += chunk) {
        try {
          await client.query(
            `INSERT INTO public.${quote(name)} OVERRIDING SYSTEM VALUE
             SELECT * FROM json_populate_recordset(null::public.${quote(name)}, $1::json)`,
            [JSON.stringify(rows.slice(start, start + chunk))],
          );
        } catch (error) {
          // 22 data exception, 23 integrity constraint violation: the file does not fit this database.
          if (/^2[23]/.test((error as { code?: string }).code ?? '')) {
            throw new HttpError(
              422,
              `The rows of ${name} do not fit this database: ${(error as Error).message}`,
            );
          }
          throw error;
        }
      }
      restored[name] = rows.length;
    }

    // Identity counters continue after the restored ids.
    for (const name of ordered) {
      for (const column of (await columnsOf(client, name)).filter((item) => item.identity)) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), greatest(coalesce(max(${quote(column.name)}), 0), 1),
                         max(${quote(column.name)}) IS NOT NULL) FROM public.${quote(name)}`,
          [`public.${quote(name)}`, column.name],
        );
      }
    }
    for (const name of ordered)
      await client.query(`ALTER TABLE public.${quote(name)} ENABLE TRIGGER USER`);
    // Files go in before the commit: if one fails the rows roll back; a file left over by a failed commit is an
    // unreferenced object (its key is never reused) that the catch below removes.
    for (const [key, bytes] of photoFiles) {
      await storage!.put(key, bytes, sniffPhotoType(bytes)!);
      written.push(key);
    }
    await client.query('COMMIT');
    return { restored, total: Object.values(restored).reduce((sum, count) => sum + count, 0) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    for (const key of written) await storage?.delete(key).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function backupRouter(
  pool: Pool,
  { today, storage }: { today: () => string; storage?: ObjectStorage },
) {
  const router = Router();
  // Its own, larger limit: a restore carries the whole database (the app-wide 256kb default is for forms).
  router.use(express.json({ limit: restoreLimit }));

  router.get('/', async (_req, res) => {
    const backup = await exportBackup(pool, undefined, storage);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="money-ledger-backup-${today()}.json"`,
    );
    res.send(JSON.stringify(backup));
  });

  router.post('/restore', async (req, res) => {
    const body = restoreBody.parse(req.body);
    res.json(await restoreBackup(pool, body, storage));
  });

  return router;
}
