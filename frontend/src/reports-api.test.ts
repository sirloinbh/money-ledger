import { beforeEach, expect, test, vi } from 'vitest';

let calls: string[];
let fixedCostsFail: boolean;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

// A fresh module for each test: the reports are made at most once per page load.
let makeReportsOnce: typeof import('./reports-api').makeReportsOnce;
beforeEach(async () => {
  calls = [];
  fixedCostsFail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (url === '/api/ledger/fixed-costs/generate') {
        return fixedCostsFail ? json({ error: 'down' }, 500) : json({ added: 1 });
      }
      return json({ created: [] });
    }),
  );
  vi.resetModules();
  ({ makeReportsOnce } = await import('./reports-api'));
});

test('reports are made after the due fixed-cost entries are added', async () => {
  await makeReportsOnce();
  expect(calls).toEqual(['POST /api/ledger/fixed-costs/generate', 'POST /api/reports/generate']);
  // Once per page load.
  await makeReportsOnce();
  expect(calls).toHaveLength(2);
});

test('no report is made when adding the due entries failed, and the next call tries again', async () => {
  fixedCostsFail = true;
  await makeReportsOnce();
  expect(calls).toEqual(['POST /api/ledger/fixed-costs/generate']);
  fixedCostsFail = false;
  await makeReportsOnce();
  expect(calls).toEqual([
    'POST /api/ledger/fixed-costs/generate',
    'POST /api/ledger/fixed-costs/generate',
    'POST /api/reports/generate',
  ]);
});
