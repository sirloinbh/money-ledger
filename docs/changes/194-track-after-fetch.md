# #194 Track opened US securities only after a fetch, without a global lock

- Issue: [#194](https://github.com/sirloinbh/money-ledger/issues/194)
- Branch: `fix/194-track-after-fetch`
- Parent: #91 Investment asset trading and valuation

## Purpose

Opening a security detail (`POST /api/prices/securities/:id/view`) called `trackOpened` before the fetch, so a ticker Tiingo answered `not_found` still took one of the 450 tracked slots for 30 days, and each reopen extended it. Every open, Korean ones too, took one global advisory lock and counted all tracked US securities. The weekly US list deactivated missing tickers with `symbol <> ALL($1::text[])`, which compares each row with the whole 10-20k list.

## Changes

- `backend/src/prices/store.ts`:
  - New `trackingRoom(db, id, now)`: `not_counted` for a Korean security, `tracked` for a US security already on the daily fetch, else `room` or `full`. Read without a lock.
  - `trackOpened` updates `viewed_at` directly for Korean and already-tracked securities. Only a new US security takes the lock and counts, as before.
  - `saveUsTickers` deactivates with `NOT EXISTS (SELECT 1 FROM unnest($1::text[]) ...)`, an anti-join.
- `backend/src/prices/router.ts`: the view route checks `trackingRoom` first (`full` → stored close with `tracking_full`, no call), fetches as before, and calls `trackOpened` only when the answer was not `not_found` or `known_missing`. If another open took the last slot in between, the answer is shown with `tracking_full` and the security is not tracked.

## Verification

- `backend/test/prices.integration.test.ts`:
  - New "a ticker Tiingo does not know never takes a tracked slot": opening an unknown ticker twice (a 404, then the stored answer) leaves `trackedUsSecurities` unchanged and `viewed_at` empty, spends one call; a known ticker opened the same way is tracked.
  - "once 450 US securities are tracked ...": the extended tracked security is now `SPY` (a ticker the fake Tiingo knows), and a tracked unknown ticker (`T1`) is answered `not_found` without its 30 days restarting.
  - The existing "the weekly US list marks tickers that left it inactive" test covers the anti-join.
- Both changed tests fail without the `src` changes and pass with them.
- Commands and results are in the PR body.

## Review

- Round 1 (PR #249 comment): approve, no blocking comments; one non-blocking nitpick (the second room read), kept as a limit below.

## Limits

- `trackOpened` reads the room again inside its own call, so a new US open runs the count twice (once unlocked, once under the lock). The unlocked read only decides whether to spend a Tiingo call.
