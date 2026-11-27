# Test database drop waits for closing connections (#379)

## Problem

`ci / verify` of PR #376 failed once with an uncaught `terminating connection due to administrator command` after `net-worth` and `reports` integration files had passed all their tests. A rerun passed; it did not reproduce in 8 local runs.

## Cause (reasoned, not proven)

`test-database.ts` dropped each file's database copy with `DROP DATABASE ... WITH (FORCE)`. `pool.end()` resolves when the pool has asked its clients to end, not when the server has closed their backends. FORCE could terminate a backend still shutting down, and its client got a fatal 57P01 error that nothing listens to. The runner reports that as asynchronous activity after the last subtest.

## Change

- `dropCopy(adminUrl, name)`: a plain `DROP DATABASE IF EXISTS` first. PostgreSQL itself waits up to about 5 s for the other sessions to go away before it answers 55006 (in use), so a backend still shutting down is waited for, not killed. If sessions are still there after that, it logs one line (`test-database: <name> still had connections after the wait, dropping it with FORCE`) and drops with FORCE, so a pool a failed test left open still cannot keep the copy alive.
- The file's `after` hook calls it. `dropLeftovers` (copies of dead processes) keeps FORCE: nothing is connected to them.

## How a future failure shows up

The unexplained error would no longer appear. If connections ever outlive that wait, the FORCE fallback log line appears in the test output and points at the pool that was not closed.

## Tests

`backend/test/test-database.integration.test.ts`: a connection closing after 300 ms gives a clean drop; a connection that stays open gives the FORCE drop with exactly one log line (this test takes about 5 s: the wait is PostgreSQL's); a missing copy is not an error.
