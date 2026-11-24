# 343 Fix the long-hold Kakao test after the shared test DB reset

## Purpose

#339 added `kakao-long-hold.integration.test.ts` with its own `DROP TABLE` list while #341 (#320) added foreign keys and a shared reset. Both merged within minutes, so main's DB tests went red (5 failures in that file).

## Changes

- `backend/test/kakao-long-hold.integration.test.ts`: the reset uses `resetDatabase` and then empties the seeded `krx_holidays`, like the other DB tests. No test file has a `DROP TABLE` list now.

## Verification

- The file's 5 tests pass on the dedicated test DB; the full `npm run check` result is in the PR.
