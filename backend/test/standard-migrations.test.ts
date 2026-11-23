// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/test/
// Type test for the migration runner (#997): MigrationDb must be one connection, so a Pool is a compile error.
// `npm run typecheck` checks this file; the run-time part only keeps the test runner from reporting an empty file.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Client, Pool, PoolClient } from 'pg';

import type { MigrationDb } from '../src/standard/migrations.js';

test('MigrationDb accepts a Client and a PoolClient but not a Pool', () => {
  const accepts = (_db: MigrationDb) => undefined;
  const client = undefined as unknown as Client;
  const poolClient = undefined as unknown as PoolClient;
  const pool = undefined as unknown as Pool;
  const check = () => {
    accepts(client);
    accepts(poolClient);
    // @ts-expect-error a Pool may run each query on a different connection, so the advisory lock would not hold
    accepts(pool);
  };
  assert.equal(typeof check, 'function');
});
