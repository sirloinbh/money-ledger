import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import express from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { createApp } from '../src/app.js';
import type { KakaoService } from '../src/kakao/service.js';
import { document, operations } from '../src/openapi.js';
import { schemaOf } from '../src/standard/openapi.js';

const accounts = '/api/mock/accounts';
const assets = '/api/portfolio/assets';

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  matchers?: ((path: string) => unknown)[];
};
// Express does not keep the path a router is mounted on, so the mounts are listed here in the order the app
// registers them, per parent prefix. The walk checks each against the router's own matcher and fails on a
// mismatch or a leftover, so a changed or new mount cannot slip by.
const mounts: Record<string, string[]> = {
  '': [
    '/api/ledger/entries/csv',
    '/api/ledger/entries/card-import',
    '/api/ledger/entries/:entryId/photos',
    '/api/backup',
    '/api/ledger/budgets',
    '/api/ledger/categories',
    '/api/ledger/entries',
    '/api/ledger/fixed-costs',
    '/api/goals',
    '/api/ledger/recurring',
    '/api/ledger/tax',
    '/api/ledger/rules',
    '/api/ledger/summary',
    '/api/reports',
    '/api/ledger/trend',
    assets,
    '/api/portfolio/net-worth',
    '/api/portfolio/income',
    '/api/kakao',
    `${accounts}/:accountId/orders`,
    `${accounts}/:accountId/holdings`,
    `${accounts}/:accountId/snapshots`,
    `${accounts}/:accountId/return`,
    accounts,
    '/api/mock/quotes',
    `${accounts}/:accountId/positions`,
    '/api/mock/positions',
    `${accounts}/:accountId/next-day-questions`,
    '/api/prices',
    '/api/news',
    '/api/picks',
  ],
  [assets]: ['/:id/trades'],
};
function walk(stack: Layer[], prefix: string): string[] {
  const expected = [...(mounts[prefix] ?? [])];
  const found = stack.flatMap((layer) => {
    if (layer.route) {
      const path = layer.route.path === '/' ? prefix : prefix + layer.route.path;
      return Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${path}`);
    }
    if (!layer.handle?.stack) return [];
    const mount = expected.shift();
    if (!mount || !layer.matchers?.[0]?.(mount))
      throw new Error(`Router mounted at an unlisted path (expected ${mount}); update mounts`);
    return walk(layer.handle.stack, prefix + mount);
  });
  if (expected.length) throw new Error(`Mounts not registered: ${expected.join(', ')}`);
  return found;
}
function registeredRoutes(app: express.Express) {
  return walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '');
}

// Routes are only registered here, never called, so no database is needed. The server always passes a jobs status
// handler (#178), so a stub stands in for it and GET /api/jobs/status is checked like every other route (#181).
const app = () =>
  createApp({} as Pool, {
    jobsStatus: (_req, res) => void res.end(),
    // #311 The Kakao routes exist only with a service; a stub registers them.
    kakao: { service: {} as KakaoService },
  });

test('docs/openapi.json is up to date with the operation table', async () => {
  const committed = JSON.parse(
    await readFile(new URL('../../docs/openapi.json', import.meta.url), 'utf8'),
  ) as unknown;
  assert.deepEqual(
    committed,
    JSON.parse(JSON.stringify(document)),
    'run `npm run openapi -w backend` and commit',
  );
});

test('the operation table and the registered routes are the same set', () => {
  assert.deepEqual(Object.keys(operations).sort(), [...registeredRoutes(app())].sort());
});

test('API paths start with /api and use lowercase words joined by hyphens', () => {
  const routes = registeredRoutes(app());
  assert.ok(routes.includes('GET /api/health'));
  for (const route of routes)
    assert.match(route, /^[A-Z]+ \/api(\/(:\w+|[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)?))*$/);
});

test('guarded routes document the sign-in, 401 and 429; the public route does not', () => {
  const paths = document.paths as Record<
    string,
    Record<string, { security?: unknown[]; responses: Record<string, unknown> }>
  >;
  assert.deepEqual(paths['/api/health']!.get!.security, []);
  assert.ok(!('401' in paths['/api/health']!.get!.responses));
  assert.ok('429' in paths['/api/me']!.get!.responses);
});

test('a type JSON Schema cannot express fails instead of being skipped', () => {
  assert.throws(() => schemaOf(z.date()), /Date cannot be represented/);
});

type Responses = Record<
  string,
  Record<string, { responses: Record<string, Record<string, unknown>> }>
>;

test('every guarded route documents 401, 429 and 503; the health check documents 429 (#181)', () => {
  const paths = document.paths as Responses;
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const codes = Object.keys(op.responses);
      const expected = path === '/api/health' ? ['429'] : ['401', '429', '503'];
      for (const code of expected)
        assert.ok(codes.includes(code), `${method} ${path} lists ${code}`);
    }
  }
  assert.ok(!('503' in paths['/api/health']!.get!.responses));
});

test('the drifted routes list what their handlers answer (#181)', () => {
  const paths = document.paths as Responses;
  assert.ok('422' in paths['/api/ledger/fixed-costs/{id}']!.patch!.responses);
  assert.ok('409' in paths['/api/mock/accounts/{accountId}/orders/preview']!.get!.responses);
  assert.deepEqual(Object.keys(paths['/api/jobs/status']!.get!.responses), [
    '200',
    '401',
    '429',
    '503',
  ]);
  assert.deepEqual(paths['/api/ledger/entries/csv']!.get!.responses['200']!.content, {
    'text/csv': { schema: { type: 'string' } },
  });
});

test('a month path parameter accepts YYYY-MM only', () => {
  const paths = document.paths as Record<
    string,
    Record<string, { parameters: { name: string; schema: { pattern: string } }[] }>
  >;
  const month = paths['/api/ledger/fixed-costs/{id}/months/{month}']!.put!.parameters.find(
    (p) => p.name === 'month',
  )!;
  const pattern = new RegExp(month.schema.pattern);
  assert.ok(pattern.test('2026-11'));
  assert.ok(!pattern.test('dddd-11'));
  assert.ok(!pattern.test('2026-13'));
});
