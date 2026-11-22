# #187 Value the asset list once and fetch after the save answers

- Issue: [#187](https://github.com/sirloinbh/money-ledger/issues/187)
- Branch: `fix/187-asset-list-speed`
- Parent: #208 Fast and maintainable asset and entry screens

## Purpose

`GET /api/portfolio/assets` ran the valuation query (`assetQuery`, which replays every trade through `portfolio_trade_positions`) three times per request: for the list, inside `readTotals`, and inside `readAllocation`. Saving an asset linked to a US security without closes awaited the Tiingo fetch before answering, so a slow Tiingo held up a save that had already committed. The comment in `allocation.ts` said "the valuation runs once", which held only inside that one statement.

## Changes

- `backend/src/assets.ts`:
  - The list route runs `assetQuery` once. The totals (`sumTotals`) and the allocation are computed from the listed rows, passed back as arrays and read with `unnest` (`listedRows`); won values go back as exact numeric text. The list, the totals and the allocation therefore always agree, so the REPEATABLE READ transaction is no longer needed.
  - `readTotals` (used by the #49 net worth save) keeps its signature and runs the valuation itself through `sumTotals`.
  - `POST /` and `PUT /:id` answer first and then hand `fetchIfMissing` to the new `background` option. `fetchIfMissing` already logs and swallows every failure.
- `backend/src/allocation.ts`: `readAllocation(db, valued, params)` takes the query and its parameters; the comment now says the list passes its own rows.
- `backend/src/app.ts`: new `background` option (default: the task just runs). Tests collect the tasks and wait for them.
- `docs/price-source.md`: the fetch on registering an asset runs after the save is answered.

## Verification

- `backend/test/valuation.integration.test.ts`:
  - New "a save answers without waiting for a slow price source": the fake Tiingo is held; the save answers 201 with "No price" while the fetch is still pending; once released, the list shows the close. On the old code the save never answers (the test times out).
  - "linking a US security without closes fetches it once": the save now answers without the close; after the fetch the list has it, still one call, and a second save does not fetch again.
  - The error and failed-fetch tests wait for the background fetch before checking the log.
  - The test's `api` helper waits for background work after each run, so no fetch lands after its test.
- `allocation`, `assets`, `net-worth` and `valuation` integration tests: 46/46 pass, unchanged list, totals and allocation expectations.
- Commands and results are in the PR body.

## Limits

- Right after linking a US security without closes, the save's answer and a list loaded before the fetch finishes show "No price"; the next load shows the close. The frontend does not poll for it.
