import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import express from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { createApp } from '../src/app.js';
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
    '/api/ledger/budgets',
    '/api/ledger/categories',
    '/api/ledger/entries',
    '/api/ledger/fixed-costs',
    '/api/ledger/rules',
    '/api/ledger/summary',
    '/api/reports',
    '/api/ledger/trend',
    assets,
    '/api/portfolio/net-worth',
    `${accounts}/:accountId/orders`,
    `${accounts}/:accountId/holdings`,
    `${accounts}/:accountId/snapshots`,
    accounts,
    '/api/prices',
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

// Routes are only registered here, never called, so no database is needed.
const app = () => createApp({} as Pool);

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
