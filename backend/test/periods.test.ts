import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

// Validation runs before the DB: a pool that fails the test if any query reaches it.
const noDb = {
  query: async () => {
    throw new Error('the request should have been rejected before the DB');
  },
} as unknown as Pool;

const invalid = [
  { query: '', error: 'Enter the start date as YYYY-MM-DD' },
  { query: 'from=2026-11-27&unit=day', error: 'Enter the count as a whole number' },
  { query: 'from=2026-11-27&unit=month&count=3', error: 'Choose the unit: day or week' },
  { query: 'from=2026-1-27&unit=day&count=3', error: 'Enter the start date as YYYY-MM-DD' },
  {
    query: 'from=2026-02-30&unit=day&count=3',
    error: 'Enter a real start date between 1900 and 2100',
  },
  {
    query: 'from=1899-12-31&unit=day&count=3',
    error: 'Enter a real start date between 1900 and 2100',
  },
  { query: 'from=2026-11-27&unit=day&count=0', error: 'Enter the count as a whole number' },
  {
    query: 'from=2026-11-27&unit=day&count=32',
    error: 'The range can be at most 31 days or 26 weeks',
  },
  {
    query: 'from=2026-11-27&unit=week&count=27',
    error: 'The range can be at most 31 days or 26 weeks',
  },
];

for (const { query, error } of invalid) {
  test(`periods for "${query}" is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/periods?${query}`);
      assert.equal(response.status, 400);
      assert.equal(
        (response.data as { error: string }).error.includes(error),
        true,
        JSON.stringify(response.data),
      );
    });
  });
}

test('a valid request reaches the DB and the rows are returned as won', async () => {
  const seen: unknown[][] = [];
  const pool = {
    query: async (_sql: string, values: unknown[]) => {
      seen.push(values);
      return {
        rows: [
          {
            start: '2026-11-22',
            end: '2026-11-28',
            income: '1000',
            expense: '400',
            balance: '600',
          },
        ],
      };
    },
  } as unknown as Pool;
  await withApi(pool, async (call) => {
    const response = await call('/api/ledger/periods?from=2026-11-27&unit=week&count=1');
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, {
      unit: 'week',
      periods: [
        { start: '2026-11-22', end: '2026-11-28', income: 1000, expense: 400, balance: 600 },
      ],
    });
    assert.deepEqual(seen, [['2026-11-27', 'week', 1]]);
  });
});
