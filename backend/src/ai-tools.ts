// The first AI tool of Money Ledger (project-standards#711, ADR-0017). shared-ai lists and calls it over
// /internal/tools; standard/tools.ts checks the signed call, the scope, and writes the audit row.
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { serviceDate as date } from './contract.js';
import { listEntries } from './ledger/entries.js';
import { defineTool } from './standard/tools.js';

type Db = Pick<Pool, 'query'>;

// A tool reads at most a year of entries, and at most one page (the list route's page size), so one call cannot
// return the whole ledger.
const MAX_DAYS = 366;
const MAX_LIMIT = 100;
const listInput = z
  .object({
    from: date,
    to: date,
    kind: z.enum(['income', 'expense']).optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
  })
  .refine((input) => input.from <= input.to, 'The start date is after the end date')
  .refine(
    (input) => (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000 <= MAX_DAYS,
    `List at most ${MAX_DAYS} days at a time`,
  );

export const tools = [
  defineTool({
    name: 'list_entries',
    description:
      'List the income and expense entries between two dates (YYYY-MM-DD, at most 366 days), newest first: date, kind, amount in won, category, merchant and memo. `limit` is the page size (default 50, at most 100); `total` counts every matching entry.',
    input: listInput,
    access: 'read',
    action: 'read',
    entity: 'ledger_entry',
    run: async ({ from, to, kind, limit }, { db }: { db: Db }) => {
      const { entries, total } = await listEntries(db, { from, to, kind, page: 1, size: limit });
      return { result: { entries, total } };
    },
  }),
];
