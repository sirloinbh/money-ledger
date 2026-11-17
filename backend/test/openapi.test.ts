import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { createApp } from '../src/app.js';
import { buildOpenApi, jsonSchema, registeredRoutes } from '../src/openapi.js';

// Routes are only registered here, never called, so no database is needed.
const app = () => createApp({} as Pool);

test('docs/openapi.json is up to date with the routes and schemas', async () => {
  const committed = JSON.parse(
    await readFile(new URL('../../docs/openapi.json', import.meta.url), 'utf8'),
  ) as unknown;
  assert.deepEqual(committed, buildOpenApi(app()), 'run `npm run openapi -w backend` and commit');
});

test('API paths start with /api and use lowercase words joined by hyphens', () => {
  const routes = registeredRoutes(app());
  assert.ok(routes.includes('GET /api/health'));
  for (const route of routes)
    assert.match(route, /^[A-Z]+ \/api(\/(:\w+|[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)?))*$/);
});

test('formats stay in the document whether they are the type or a check', () => {
  assert.deepEqual(jsonSchema(z.int().min(1)), { type: 'integer', minimum: 1 });
  assert.deepEqual(jsonSchema(z.number().int()), { type: 'integer' });
  assert.deepEqual(jsonSchema(z.uuid()), { type: 'string', format: 'uuid' });
  assert.deepEqual(jsonSchema(z.guid()), { type: 'string', format: 'uuid' });
  assert.deepEqual(jsonSchema(z.string().uuid()), { type: 'string', format: 'uuid' });
  assert.deepEqual(jsonSchema(z.email()), { type: 'string', format: 'email' });
  assert.deepEqual(jsonSchema(z.iso.date()), { type: 'string', format: 'date' });
  assert.deepEqual(jsonSchema(z.iso.datetime()), { type: 'string', format: 'date-time' });
});

test('a preprocessed value is described by its target', () => {
  assert.deepEqual(jsonSchema(z.preprocess((value) => value, z.string().min(1))), {
    type: 'string',
    minLength: 1,
  });
});

test('unsupported schemas and undocumented routes fail instead of being skipped', () => {
  assert.throws(() => jsonSchema(z.date()), /Unsupported Zod type for OpenAPI: date/);
  assert.throws(() => jsonSchema(z.ulid()), /Unsupported string format: ulid/);
  const extended = app();
  extended.get('/api/undocumented', (_req, res) => void res.json({}));
  assert.throws(() => buildOpenApi(extended), /\+GET \/api\/undocumented/);
});

test('a union and a literal are described, as in the entry list category filter', () => {
  assert.deepEqual(jsonSchema(z.union([z.literal('none'), z.string().regex(/^\d+$/)])), {
    anyOf: [
      { type: 'string', enum: ['none'] },
      { type: 'string', pattern: String.raw`^\d+$` },
    ],
  });
});

test('every route of the nested routers is found, with its full path', () => {
  const routes = registeredRoutes(app());
  assert.ok(routes.includes('GET /api/portfolio/assets/:id/trades'));
  assert.ok(routes.includes('POST /api/mock/accounts/:accountId/orders'));
  assert.ok(routes.includes('PUT /api/ledger/fixed-costs/:id/months/:month'));
  assert.equal(new Set(routes).size, routes.length, 'no route is listed twice');
});
