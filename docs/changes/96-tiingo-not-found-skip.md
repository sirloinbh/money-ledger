# #96 Cut repeated calls for tracked tickers Tiingo does not have

- Issue: https://github.com/sirloinbh/money-ledger/issues/96
- Branch: `chore/96-tiingo-not-found-skip`

## Purpose

Once a US ticker Tiingo does not have became tracked, the daily fetch spent one 404 call on it every day for 30 days. A ticker with no close at all called Tiingo on every detail open. Both wasted the shared 50-calls-per-hour limit and could push the daily fetch into `rate_limited`. This came up in the #51 (PR #95) review.

## Decisions (confirmed by the user on 2026-11-10, recorded in the issue comments)

1. A Tiingo 404 ticker is skipped inside `fetchUsCloses` for 7 days after the last call, for both the daily fetch and the detail's on-the-spot fetch. It answers "not found" without a call, and the daily fetch writes no `price_fetch_failed` log for a skipped ticker.
2. A ticker with no close is not called again from the detail when its last call (`last_attempt_at`) was within 1 hour. The screen follows the previous result: no message after an empty answer, "Could not get the price…" after an error. The daily fetch retries are not affected.

## Changes

- `backend/src/prices/store.ts`: `getState` also returns `last_error`.
- `backend/src/prices/fetch.ts`: `fetchUsCloses` gets both rules. They are checked only when dates are left to fetch, and neither spends the call limit.
  - When `last_error` is the not-found note and fewer than 7 days have passed since the last call, it returns `known_missing`. The daily run starts a few milliseconds later or earlier each day, so the window is 1 hour short (6 days 23 hours) to keep the 7th day's run from just missing it.
  - With the optional `retryAfterMs`, a call within that time returns `tried_recently` (the last answer was empty) or `failed_recently` (the last answer was an error). The daily fetch does not pass it.
- `backend/src/prices/router.ts`: the detail's on-the-spot fetch passes `retryAfterMs` of 1 hour. `known_missing` shows as `not_found` and `failed_recently` as `fetch_failed`; since no call was made, no `price_fetch_now` log is written.
- `docs/price-source.md`: both rules are written down.

The DB structure does not change (only the existing `price_fetch_state` columns are used).

## Verification

### wip commit (agent3, 2026-11-10)

- Test DB: dedicated container `money-ledger-test-agent3` (15493).
- `backend/test/prices.integration.test.ts`
  - Missing ticker: called once on the first day, not called by the daily fetch for the next 6 days and no log for it; opening the detail in between answers `not_found` without a call; called once again on day 7.
  - Ticker with no close: opening the detail of an empty-answer ticker and of an error ticker calls each once. Reopening 59 minutes later shows the previous result (no message, `fetch_failed`) without a call, and 1 hour later it calls again.
- The file alone: 22/22 passed. `tsc` and `npm run knip` passed. The full `npm run check` exited 1, cause not found then.

### Merge of origin/main (2026-11-15)

- Main translated the server messages and `docs/price-source.md` to English (#120, #125). Conflicts in `fetch.ts` and `docs/price-source.md` were resolved by keeping the English text: the not-found note is now `Not found at Tiingo`, and the two #96 rules were added to the English doc. The test strings were translated to match.
- Removed the unused `calls` variable in the hourly-retry test. ESLint flagged it, which is likely why the full check failed in the wip commit.
- `npm run check` (with `TEST_DATABASE_URL` unset): passed. Backend 189 tests: 173 passed, 16 skipped (the DB integration tests, including both #96 tests), 0 failed. Frontend 313 tests: 311 passed, 2 skipped.
- `npm run knip`: passed.
- Not run locally: the DB integration tests, because Docker Desktop was not running. CI runs them against PostgreSQL.
