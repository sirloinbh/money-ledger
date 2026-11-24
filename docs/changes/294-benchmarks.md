# Compare the mock account return with a deposit and two fixed rates (#294, part 2)

Part 2 of #294 (part 1 is [294-time-weighted-return.md](294-time-weighted-return.md)). The user's final scope on 2026-11-24: lay the time-weighted account return next to three benchmarks over the same days. No KOSPI and no S&P 500.

| Benchmark                              | How it is calculated                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Deposit at the Bank of Korea base rate | Each day after the start grows by `1 + rate / 100 / 365` with the rate in effect that day, so a rate change applies from its day |
| Warren Buffett, 20% a year             | `(1 + 0.20) ^ (days / 365) - 1`                                                                                                  |
| Renaissance fund, 66% a year           | `(1 + 0.66) ^ (days / 365) - 1`                                                                                                  |

Everything runs in SQL `numeric`, rounded half away from zero to 2 places. The period is the account return's own period (first value to last value), so the numbers can be read side by side.

## Changes

| File                                                                    | Change                                                                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/040_base_rates.sql`                                | New table `base_rates` (one row per published day). Numbered above main's highest (039) as the coordinator asked            |
| `backend/src/prices/ecos.ts`, `backend/src/prices/benchmark-sources.ts` | The ECOS base rate source, its parser, and a fake for `PRICE_SOURCE=fake`                                                   |
| `backend/src/benchmark-fetch.ts`                                        | The daily job (queue `benchmarks`, hourly 12:30-18:30 KST) that stores the base rate; `ECOS_API_KEY` turns it on            |
| `backend/src/benchmark.ts`                                              | `benchmarks` next to `account` in `GET /api/mock/accounts/:accountId/return`; the two fixed rates live in `fixedBenchmarks` |
| `backend/src/server.ts`, `.env.example`                                 | The queue is appended to the job list; `ECOS_API_KEY` (name only) is added                                                  |
| `frontend/src/return-comparison.tsx`                                    | A table under the return summary: your trades, deposit, Buffett, Renaissance, with the yearly rate and the return           |
| `docs/price-source.md`                                                  | New sections "Base rate (ECOS)" and "Benchmarks for the account return"                                                     |

## Not checked with a real key

The ECOS table code (`722Y001`), item code (`0101000`) and answer fields come from secondary sources, and the key is still pending ([#304](https://github.com/sirloinbh/money-ledger/issues/304)). This is reported as "waiting on #304", not as verified. Until the key exists the deposit shows "No rate yet" on screen; the fixed rates always show.

## Tests

- `backend/test/benchmark.integration.test.ts` (real DB): a 364-day period with the base rate changing from 2.5% to 3.5% in the middle gives deposit 3.04%, Buffett 19.94% and Renaissance 65.77%, matching an independent calculation; no base rate on the start day makes only the deposit `null`; no period makes all three `null`.
- `backend/test/ecos.test.ts`: rows, `INFO-200` as empty, errors without the key.
- `backend/test/benchmark-fetch.integration.test.ts` (real DB): first run from 2020, nothing asked when up to date, only the new days next day, empty answers counted as checked, a re-sent day replaced, a failure recorded without storing, no source is not a failure.
- `frontend/src/return-comparison.test.tsx`: the table rows and a deposit without a stored rate.

## Verification

- `npm run check` passed on 2026-11-24 (backend with 0 skipped on the dedicated test DB `money_test` of lane 4), and `npm run knip` shows no unused export of this change.
- Real browser (Playwright Chromium, a seeded 20-day-old account worth +4.2%, base rate 2.5% until 11 days into the period and 3.0% after): at 390x844 and 1440x900 the table shows `Your trades +4.2%`, `Deposit ... 3% +0.14%`, `Warren Buffett 20% +0.95%`, `Renaissance fund 66% +2.67%` with no horizontal scroll (table 308 px in a 358 px card on mobile).
- Hand check over the 19 days of that period: deposit (11 x 2.5 + 8 x 3.0) / 365 = 0.141%, `1.2 ^ (19/365) - 1` = 0.95%, `1.66 ^ (19/365) - 1` = 2.67%.
- Waiting on #304: the ECOS key. The real answer of ECOS (table and item codes) has not been checked.
