import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseEcosRates } from '../src/prices/ecos.js';
import { SourceError } from '../src/prices/sources.js';

// #294 The ECOS answer of the base rate (StatisticSearch). Not checked against a real key yet (#304).
const answer = (rows: unknown[]) => ({
  StatisticSearch: { list_total_count: rows.length, row: rows },
});

test('rows become dates and percent strings', () => {
  assert.deepEqual(
    parseEcosRates(
      answer([
        { TIME: '20250529', DATA_VALUE: '2.5', STAT_NAME: 'x' },
        { TIME: '20251127', DATA_VALUE: '2.50' },
      ]),
    ),
    [
      { date: '2025-05-29', ratePct: '2.5' },
      { date: '2025-11-27', ratePct: '2.50' },
    ],
  );
});

test('"no data" (INFO-200) is an empty list, not a failure', () => {
  assert.deepEqual(parseEcosRates({ RESULT: { CODE: 'INFO-200', MESSAGE: 'none' } }), []);
});

test('other result codes, a missing row list and bad values are failures without the key or URL', () => {
  assert.throws(
    () => parseEcosRates({ RESULT: { CODE: 'ERROR-100', MESSAGE: 'bad key' } }),
    (error: unknown) => error instanceof SourceError && error.message.includes('ERROR-100'),
  );
  assert.throws(() => parseEcosRates({}), SourceError);
  assert.throws(
    () => parseEcosRates(answer([{ TIME: '2025-05-29', DATA_VALUE: '2.5' }])),
    SourceError,
  );
  assert.throws(() => parseEcosRates(answer([{ TIME: '20250529', DATA_VALUE: '-' }])), SourceError);
  assert.throws(
    () => parseEcosRates(answer([{ TIME: '20250529', DATA_VALUE: '250' }])),
    SourceError,
  );
});
