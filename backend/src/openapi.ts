// The API's operation table. The document is built by the managed standard/openapi.ts from Zod schemas
// (z.toJSONSchema). `npm run openapi -w backend` writes docs/openapi.json; a test fails when it is out of date or
// when the table and the registered routes differ.
import { z } from 'zod/v4';

import * as budgets from './ledger/budgets.js';
import * as categories from './ledger/categories.js';
import * as entries from './ledger/entries.js';
import * as csv from './ledger/entry-csv.js';
import * as fixedCosts from './ledger/fixed-costs.js';
import * as rules from './ledger/rules.js';
import * as summary from './ledger/summary.js';
import * as trend from './ledger/trend.js';
import * as accountsModule from './mock/accounts.js';
import * as orders from './mock/orders.js';
import * as news from './news/router.js';
import * as picks from './picks/router.js';
import * as assetsModule from './portfolio/asset-schema.js';
import * as netWorth from './portfolio/net-worth.js';
import * as trades from './portfolio/trades.js';
import * as prices from './prices/router.js';
import { buildOpenApi, type Operation } from './standard/openapi.js';

const accounts = '/api/mock/accounts';
const assets = '/api/portfolio/assets';
// A month path parameter is YYYY-MM.
const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// Every registered route must appear here exactly once (checked when building).
const table: Record<string, Operation> = {
  'GET /api/health': {
    summary: 'Check the server and the database connection',
    // Public, but behind the rate limit like every /api route.
    status: [200, 429, 500],
    public: true,
  },
  'GET /api/me': { summary: 'Get the signed-in user', status: [200] },
  'GET /api/jobs/status': {
    summary: 'Get the background job queues, recent and failed jobs, and schedules',
    // 503 also when background jobs are off, still starting, or failed to start (#178).
    status: [200],
  },
  'GET /api/ledger/entries/csv': {
    summary: 'Export the filtered entries as a CSV file',
    query: entries.listQuery,
    status: [200, 400],
    produces: 'text/csv',
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
    // 422: the category is gone or not an expense category.
    status: [200, 400, 404, 422],
  },
  'POST /api/ledger/fixed-costs/generate': {
    summary: 'Create the entries of the fixed costs that are due',
    status: [200],
  },
  'PUT /api/ledger/fixed-costs/:id/months/:month': {
    params: { month: monthParam },
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
    // 409: the account was already reset (closed).
    status: [200, 400, 404, 409],
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
  'GET /api/news': {
    summary: 'List the economy news headlines stored on a date (default today)',
    query: news.listQuery,
    status: [200, 400],
  },
  'POST /api/news/fetch': {
    summary: 'Fetch and store the economy news headlines now',
    // 503: no news source is configured.
    status: [200, 503],
  },
  'GET /api/picks': {
    summary: 'Get the Claude pick of a date (default today) with the news behind it',
    query: picks.dateQuery,
    status: [200, 400],
  },
  'POST /api/picks/run': {
    summary: 'Run the daily pick now: ask Claude, store the pick and place the all-in buy',
    // 503: no Claude client is configured.
    status: [200, 503],
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

// The shared sign-in in front of every guarded route answers 503 when the sign-in service is down; the standard
// builder adds only 401 and 429 (and 413 with a body), so 503 is added here (#181).
export const operations: Record<string, Operation> = Object.fromEntries(
  Object.entries(table).map(([route, op]) => [
    route,
    op.public ? op : { ...op, status: [...op.status, 503] },
  ]),
);

const statusText: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  204: 'Deleted',
  400: 'Invalid input',
  401: 'Sign-in required',
  404: 'Not found',
  409: 'Duplicate or conflict',
  422: 'Valid input the server cannot process',
  429: 'Too many requests',
  500: 'Server error',
  503: 'Sign-in service unavailable (on /api/jobs/status also: background jobs not running)',
};

export const document = buildOpenApi({
  title: 'Money Ledger API',
  description:
    'Dates are YYYY-MM-DD (Asia/Seoul). Every error response is { error: English message }.',
  errorDescription: 'English error message',
  operations,
  statusText,
});
