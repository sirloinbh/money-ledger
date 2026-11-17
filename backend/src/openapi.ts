// OpenAPI 3.1 document built from the registered Express routes and the server's own Zod schemas.
// `npm run openapi -w backend` writes docs/openapi.json; a test fails when it is out of date.
import type express from 'express';
import type { z } from 'zod/v4';

import * as assetsModule from './assets.js';
import * as budgets from './budgets.js';
import * as categories from './categories.js';
import * as entries from './entries.js';
import * as csv from './entry-csv.js';
import * as fixedCosts from './fixed-costs.js';
import * as accountsModule from './mock-accounts.js';
import * as orders from './mock-orders.js';
import * as netWorth from './net-worth.js';
import * as prices from './prices/router.js';
import * as rules from './rules.js';
import * as summary from './summary.js';
import * as trades from './trades.js';
import * as trend from './trend.js';

type Json = Record<string, unknown>;

type CheckDef = {
  check: string;
  format?: string;
  pattern?: RegExp;
  minimum?: number;
  maximum?: number;
  length?: number;
  value?: number;
  inclusive?: boolean;
};
const checksOf = (def: Json) =>
  ((def.checks ?? []) as { _zod: { def: CheckDef } }[]).map((check) => check._zod.def);

const STRING_FORMATS: Record<string, string> = {
  uuid: 'uuid',
  guid: 'uuid',
  email: 'email',
  url: 'uri',
  datetime: 'date-time',
  date: 'date',
  time: 'time',
};
function stringFormat(format: string) {
  const name = STRING_FORMATS[format];
  if (!name) throw new Error(`Unsupported string format: ${format}`);
  return name;
}
// z.number().int() is a check and z.int() is the type itself; float32 and float64 are the same kinds but not integers.
const isIntegerFormat = (format: unknown) => typeof format === 'string' && format.includes('int');

// Converts the Zod 4 types the API uses. Refinements (cross-field rules) cannot be expressed
// here; any other unsupported type fails loudly instead of being silently dropped.
export function jsonSchema(schema: z.ZodType): Json {
  const def = schema._zod.def as unknown as Json & { type: string };
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, z.ZodType>;
      const required = Object.keys(shape).filter((key) => !shape[key].isOptional());
      const catchall = def.catchall as z.ZodType | undefined;
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, jsonSchema(v)])),
        ...(required.length ? { required } : {}),
        ...(catchall?._zod.def.type === 'never' ? { additionalProperties: false } : {}),
      };
    }
    case 'string': {
      const out: Json = { type: 'string' };
      // z.uuid() and z.email() carry their format on the type, z.string().uuid() as a check.
      if (def.format) out.format = stringFormat(def.format as string);
      for (const check of checksOf(def)) {
        if (check.check === 'min_length') out.minLength = check.minimum;
        else if (check.check === 'max_length') out.maxLength = check.maximum;
        else if (check.check === 'length_equals') out.minLength = out.maxLength = check.length;
        else if (check.check === 'string_format' && check.format === 'regex')
          out.pattern = check.pattern!.source;
        else if (check.check === 'string_format') out.format = stringFormat(check.format!);
        // `overwrite` is trim(); `custom` is a refinement.
        else if (check.check !== 'overwrite' && check.check !== 'custom')
          throw new Error(`Unsupported string check: ${check.format ?? check.check}`);
      }
      return out;
    }
    case 'number': {
      const out: Json = { type: isIntegerFormat(def.format) ? 'integer' : 'number' };
      for (const check of checksOf(def)) {
        if (check.check === 'number_format') {
          if (isIntegerFormat(check.format)) out.type = 'integer';
        } else if (check.check === 'greater_than')
          out[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
        else if (check.check === 'less_than')
          out[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
        else if (check.check === 'multiple_of') out.multipleOf = check.value;
        else if (check.check !== 'custom')
          throw new Error(`Unsupported number check: ${check.check}`);
      }
      return out;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'array': {
      let min: number | undefined;
      let max: number | undefined;
      for (const check of checksOf(def)) {
        if (check.check === 'min_length') min = check.minimum;
        else if (check.check === 'max_length') max = check.maximum;
        else if (check.check === 'length_equals') min = max = check.length;
        else if (check.check !== 'custom')
          throw new Error(`Unsupported array check: ${check.check}`);
      }
      return {
        type: 'array',
        items: jsonSchema(def.element as z.ZodType),
        ...(min !== undefined ? { minItems: min } : {}),
        ...(max !== undefined ? { maxItems: max } : {}),
      };
    }
    case 'enum':
      return { type: 'string', enum: Object.values(def.entries as Record<string, string>) };
    case 'nullable': {
      const inner = jsonSchema(def.innerType as z.ZodType);
      return typeof inner.type === 'string'
        ? { ...inner, type: [inner.type, 'null'] }
        : { anyOf: [inner, { type: 'null' }] };
    }
    case 'optional':
      return jsonSchema(def.innerType as z.ZodType);
    case 'default':
      return { ...jsonSchema(def.innerType as z.ZodType), default: def.defaultValue };
    // .transform() is a pipe; the request is described by what comes in. z.preprocess() is a pipe
    // starting from a transform, which says nothing about the value, so its target describes it.
    case 'pipe': {
      const input = def.in as z.ZodType;
      return jsonSchema(input._zod.def.type === 'transform' ? (def.out as z.ZodType) : input);
    }
    case 'union':
      return { anyOf: (def.options as z.ZodType[]).map((option) => jsonSchema(option)) };
    case 'literal':
      return { type: 'string', enum: def.values };
    case 'unknown':
      return {};
    default:
      throw new Error(`Unsupported Zod type for OpenAPI: ${def.type}`);
  }
}

type Operation = {
  summary: string;
  body?: [name: string, schema: z.ZodType];
  query?: z.ZodType;
  // Success status first; the rest are documented error statuses.
  status: number[];
};
const accounts = '/api/mock/accounts';
const assets = '/api/portfolio/assets';
// Every registered route must appear here exactly once (checked when building).
const operations: Record<string, Operation> = {
  'GET /api/health': {
    summary: 'Check the server and the database connection',
    status: [200, 500],
  },
  'GET /api/me': { summary: 'Get the signed-in user', status: [200, 401, 503] },
  'GET /api/ledger/entries/csv': {
    summary: 'Export the filtered entries as a CSV file',
    query: entries.listQuery,
    status: [200, 400],
  },
  'POST /api/ledger/entries/csv/preview': {
    summary: 'Check the rows of a CSV import and flag likely duplicates',
    body: ['CsvImportBody', csv.importBody],
    status: [200, 400],
  },
  'POST /api/ledger/entries/csv/import': {
    summary: 'Save the rows of a CSV import in one transaction, or none when any row is invalid',
    body: ['CsvImportBody', csv.importBody],
    status: [200, 400, 422],
  },
  'GET /api/ledger/budgets': {
    summary: 'List the budgets and the spending of each expense category for a month',
    query: budgets.monthQuery,
    status: [200, 400],
  },
  'PUT /api/ledger/budgets/:categoryId': {
    summary: 'Set the budget of an expense category from a month on',
    body: ['BudgetBody', budgets.saveBody],
    status: [200, 400, 404],
  },
  'GET /api/ledger/categories': {
    summary: 'List the categories',
    query: categories.listQuery,
    status: [200, 400],
  },
  'POST /api/ledger/categories': {
    summary: 'Create a category',
    body: ['CategoryCreateBody', categories.createBody],
    status: [201, 400, 409],
  },
  'PATCH /api/ledger/categories/:id': {
    summary: 'Rename a category or hide or show it',
    body: ['CategoryUpdateBody', categories.updateBody],
    status: [200, 400, 404, 409],
  },
  'GET /api/ledger/entries': {
    summary: 'List the entries a page at a time, with filters',
    query: entries.listQuery,
    status: [200, 400],
  },
  'POST /api/ledger/entries': {
    summary: 'Create an entry',
    body: ['EntryBody', entries.entryBody],
    status: [201, 400, 409],
  },
  'POST /api/ledger/entries/classify': {
    summary: 'Put the chosen entries into a category, optionally saving each merchant as a rule',
    body: ['EntryClassifyBody', entries.classifyBody],
    status: [200, 400],
  },
  'GET /api/ledger/entries/suggestions': {
    summary: 'List category suggestions for uncategorized entries',
    status: [200],
  },
  'POST /api/ledger/entries/apply-suggestions': {
    summary: 'Apply the category suggestions to the chosen entries',
    body: ['EntryApplySuggestionsBody', entries.applySuggestionsBody],
    status: [200, 400],
  },
  'POST /api/ledger/entries/apply-rules': {
    summary: 'Apply the keyword rules to all uncategorized entries',
    status: [200],
  },
  'PUT /api/ledger/entries/:id': {
    summary: 'Replace an entry',
    body: ['EntryBody', entries.entryBody],
    status: [200, 400, 404, 409],
  },
  'DELETE /api/ledger/entries/:id': { summary: 'Delete an entry', status: [204, 400, 404] },
  'GET /api/ledger/fixed-costs': {
    summary: 'List the fixed costs with their status for a month',
    query: fixedCosts.monthQuery,
    status: [200, 400],
  },
  'POST /api/ledger/fixed-costs': {
    summary: 'Create a fixed cost',
    body: ['FixedCostCreateBody', fixedCosts.createBody],
    status: [201, 400, 422],
  },
  'PATCH /api/ledger/fixed-costs/:id': {
    summary: 'Change or deactivate a fixed cost',
    body: ['FixedCostUpdateBody', fixedCosts.updateBody],
    status: [200, 400, 404],
  },
  'POST /api/ledger/fixed-costs/generate': {
    summary: 'Create the entries of the fixed costs that are due',
    status: [200],
  },
  'PUT /api/ledger/fixed-costs/:id/months/:month': {
    summary: 'Confirm the amount of a variable fixed cost for a month',
    body: ['FixedCostConfirmBody', fixedCosts.confirmBody],
    status: [200, 400, 404],
  },
  'GET /api/ledger/rules': { summary: 'List the keyword rules', status: [200] },
  'POST /api/ledger/rules': {
    summary: 'Create a keyword rule that picks a category from a merchant',
    body: ['RuleBody', rules.ruleBody],
    status: [201, 400, 409],
  },
  'DELETE /api/ledger/rules/:id': { summary: 'Delete a keyword rule', status: [204, 400, 404] },
  'GET /api/ledger/summary': {
    summary: 'Get the income, expense and category totals of a month',
    query: summary.monthQuery,
    status: [200, 400],
  },
  'POST /api/reports/generate': { summary: 'Generate the reports that are due', status: [200] },
  'GET /api/reports': { summary: 'List the reports', status: [200] },
  'GET /api/reports/:id': { summary: 'Get a report', status: [200, 400, 404] },
  'PUT /api/reports/:id/seen': { summary: 'Mark a report as seen', status: [200, 400, 404] },
  'GET /api/ledger/trend': {
    summary: 'Get the monthly income, expense and balance over a period',
    query: trend.trendQuery,
    status: [200, 400],
  },
  [`GET ${assets}`]: {
    summary: 'List the assets with their valuation and the allocation on a date',
    query: assetsModule.listQuery,
    status: [200, 400],
  },
  [`POST ${assets}`]: {
    summary: 'Create an asset',
    body: ['AssetBody', assetsModule.assetBody],
    status: [201, 400],
  },
  [`PUT ${assets}/:id`]: {
    summary: 'Replace an asset',
    body: ['AssetBody', assetsModule.assetBody],
    status: [200, 400, 404],
  },
  [`DELETE ${assets}/:id`]: { summary: 'Delete an asset', status: [204, 400, 404] },
  [`GET ${assets}/:id/usages`]: {
    summary: 'List the usage records of a prepaid voucher',
    status: [200, 400, 404],
  },
  [`POST ${assets}/:id/usages`]: {
    summary: 'Record a use of a prepaid voucher',
    body: ['AssetUsageBody', assetsModule.usageBody],
    status: [201, 400, 404],
  },
  [`DELETE ${assets}/:id/usages/:usageId`]: {
    summary: 'Delete a usage record',
    status: [204, 400, 404],
  },
  [`GET ${assets}/:id/trades`]: {
    summary: 'List the buy and sell records of an asset',
    status: [200, 400, 404],
  },
  [`POST ${assets}/:id/trades`]: {
    summary: 'Record a buy or sell of an asset',
    body: ['TradeBody', trades.tradeBody],
    status: [201, 400, 404],
  },
  [`PUT ${assets}/:id/trades/:tradeId`]: {
    summary: 'Replace a trade record',
    body: ['TradeBody', trades.tradeBody],
    status: [200, 400, 404],
  },
  [`DELETE ${assets}/:id/trades/:tradeId`]: {
    summary: 'Delete a trade record',
    status: [204, 400, 404],
  },
  'GET /api/portfolio/net-worth': {
    summary: 'Get the net worth history and its current values',
    query: netWorth.listQuery,
    status: [200, 400],
  },
  'POST /api/portfolio/net-worth': {
    summary: 'Save the net worth snapshot of today',
    status: [200, 422],
  },
  [`GET ${accounts}/:accountId/orders`]: {
    summary: 'List the orders of a mock trading account, newest first, a page at a time',
    query: orders.historyQuery,
    status: [200, 400, 404],
  },
  [`GET ${accounts}/:accountId/orders/preview`]: {
    summary: 'Preview the fill of a mock order',
    query: orders.previewQuery,
    status: [200, 400, 404],
  },
  [`POST ${accounts}/:accountId/orders`]: {
    summary:
      'Place a mock order; 201 for a new order, 200 when the same request key was already filled',
    body: ['MockOrderBody', orders.orderBody],
    status: [201, 400, 404, 409],
  },
  [`GET ${accounts}/:accountId/holdings`]: {
    summary: 'Get the holdings and the value of a mock trading account',
    status: [200, 400, 404],
  },
  [`GET ${accounts}/:accountId/snapshots`]: {
    summary: 'List the daily value snapshots of a mock trading account',
    status: [200, 400, 404],
  },
  [`GET ${accounts}`]: { summary: 'List the mock trading accounts', status: [200] },
  [`POST ${accounts}`]: {
    summary: 'Open the mock trading account',
    body: ['MockAccountBody', accountsModule.accountBody],
    status: [201, 400, 409],
  },
  [`POST ${accounts}/:id/reset`]: {
    summary: 'Close a mock trading account and open a new one',
    body: ['MockAccountBody', accountsModule.accountBody],
    status: [200, 400, 404, 409],
  },
  'GET /api/prices/securities': {
    summary: 'Search the securities by name or symbol',
    query: prices.searchQuery,
    status: [200, 400],
  },
  'GET /api/prices/securities/:id': { summary: 'Get a security', status: [200, 400, 404] },
  'POST /api/prices/securities/:id/view': {
    summary: 'Open a security: fetch its latest prices and keep tracking it',
    status: [200, 400, 404],
  },
};

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
export function registeredRoutes(app: express.Express) {
  return walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '');
}

const statusText: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  204: 'Deleted',
  400: 'Invalid input',
  401: 'Sign-in required',
  404: 'Not found',
  409: 'Duplicate or conflict',
  422: 'Valid input the server cannot process',
  500: 'Server error',
  503: 'Sign-in service unavailable',
};

// Path parameters: ids are positive integers and a month is YYYY-MM.
const paramSchema = (name: string): Json =>
  name === 'id' || name.endsWith('Id')
    ? { type: 'integer', minimum: 1 }
    : name === 'month'
      ? { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }
      : { type: 'string' };

export function buildOpenApi(app: express.Express) {
  const routes = registeredRoutes(app);
  const missing = routes.filter((route) => !operations[route]);
  const extra = Object.keys(operations).filter((route) => !routes.includes(route));
  if (missing.length || extra.length)
    throw new Error(`OpenAPI operations differ from routes: +${missing} -${extra}`);
  const schemas: Json = {
    Error: {
      type: 'object',
      properties: { error: { type: 'string', description: 'Error message in English' } },
      required: ['error'],
    },
  };
  const paths: Record<string, Json> = {};
  for (const route of [...routes].sort()) {
    const [method, path] = route.split(' ');
    const op = operations[route];
    const parameters: Json[] = [...path.matchAll(/:(\w+)/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: paramSchema(name),
    }));
    if (op.query) {
      const query = jsonSchema(op.query) as { properties: Json; required?: string[] };
      for (const [name, schema] of Object.entries(query.properties))
        parameters.push({ name, in: 'query', required: !!query.required?.includes(name), schema });
    }
    if (op.body) schemas[op.body[0]] = jsonSchema(op.body[1]);
    const [success, ...failures] = op.status;
    const responses: Json = { [success]: { description: statusText[success] } };
    for (const status of failures)
      responses[status] = {
        description: statusText[status],
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      };
    const key = path.replace(/:(\w+)/g, '{$1}');
    paths[key] ??= {};
    paths[key][method.toLowerCase()] = {
      summary: op.summary,
      ...(parameters.length ? { parameters } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${op.body[0]}` } },
              },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Money Ledger API',
      version: '1.0.0',
      description:
        'Dates are YYYY-MM-DD (Asia/Seoul). Every error response is { error: English message }.',
    },
    servers: [{ url: '/' }],
    paths,
    components: { schemas },
  };
}
