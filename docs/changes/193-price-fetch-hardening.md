# #193 Harden the daily price fetch against bad answers and fake prices

- Issue: [#193](https://github.com/sirloinbh/money-ledger/issues/193)
- Branch: `fix/193-price-fetch-hardening`
- Parent: #91 Investment asset trading and valuation

## Purpose

The daily fetch stopped at the first DB error, read a changed KRX format as holidays, accepted a cut-off ZIP, stored fake closes in production with `PRICE_SOURCE=fake`, relied on the queue policy alone to avoid parallel runs, and recognized a Tiingo 404 by comparing message text (which stopped matching rows saved before the English translation).

## Changes

- `backend/src/prices/fetch.ts`: each source's state read, fetch and save sit in one `try`. A failure (DB or source) is logged and recorded for that source only, and the run goes on. Recording the failure is best effort (`price_state_error` is logged if that write fails too). A DB error while listing tracked US securities, or around one security's call, is a failure of that scope.
- `backend/src/prices/krx.ts`: an answer whose items lack `ISU_NM`, `TDD_CLSPRC` and `ISU_SRT_CD`/`ISU_CD` throws a `SourceError`. Items that have the fields but no usable value (no trade that day) are still left out.
- `backend/src/prices/zip.ts`: refuses data that runs past the end of the archive and a file whose length differs from the size in the central directory.
- `backend/src/prices/index.ts`: `sourcesFromEnv` throws for `PRICE_SOURCE=fake` with `NODE_ENV=production` (the backend Docker image sets it), and logs any other non-empty value as `price_source_unknown`.
- `backend/src/prices/scheduler.ts`: `runIfDue` holds a session `pg_try_advisory_lock` on a dedicated connection for the due check and the run. A second caller returns `false`. If unlocking fails, the connection is discarded, which ends the lock.
- `database/migrations/024_price_fetch_not_found.sql` (first held as 032, renamed to the next free number above `origin/main`, coordinator rule 2026-11-22; checked again right before merging): adds `price_fetch_state.not_found boolean NOT NULL DEFAULT false` and sets it for Tiingo rows saved under either message text, the Korean one from before #120 and `Not found at Tiingo`. `store.ts` reads and writes the flag; `markFailed` clears it.
- `docs/price-source.md`: the fake refusal, the lock, the per-source failures, the KRX field check and the flag.
- Tests that recreate `price_fetch_state` (`allocation`, `mock-orders`, `net-worth`, `valuation`, `prices`) apply the new migration.

### 012 backfill check

`012_krx_listing.sql` only fills `krx_market_days` and `krx_last_seen`; it changes no `active` flag. Securities become inactive only in `saveKrxDay`, after 10 stored market days without them, and a security that shows up again in a day's data is set active by the same upsert. A long-listed security wrongly marked inactive would therefore come back on the next fetch. No KRX key is set yet (#85), so no real KRX data has been saved anywhere. No reactivation migration is added. The server DB itself was not inspected (user-only access).

## Verification

- `backend/test/prices.integration.test.ts`:
  - "a DB error in one source still runs the others": every KRX state query fails; no KRX call is made, each market logs `price_fetch_failed`, and the rate and the US list are still fetched.
  - "two runs due at the same time: only one fetches": two concurrent `runIfDue` calls return `[false, true]`, KRX gets 30 calls (one run), and a later due hour runs again.
  - "a 404 stored as text before 024, in either language, is still skipped": rows with the Korean and the English text are flagged by the migration and not asked for again.
  - The #96 test also checks the `not_found` flag.
- `backend/test/prices.test.ts`: a KRX answer with renamed or missing fields fails; a ZIP with data past the end or a wrong size fails; `PRICE_SOURCE=fake` in production throws and an unknown value is logged.
- Without the `src` changes, the new tests fail (7 failures including the #96 flag assertion); with them, `prices.integration`, `prices` and `jobs.integration` pass 44/44 three times in a row.
- Commands and results are in the PR body.

## Review

- Round 1 (PR #242 comment): approve, no blocking comments. Confirmed that `tiingo.tickers()` wraps the ZIP errors in a `SourceError`, so stored messages stay plain.

## Limits

- The real KRX response shape is still unverified until the key from #85 arrives; the field check uses the names from the secondary sources.
