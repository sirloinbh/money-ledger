# #185 Daily job for fixed costs, finished reports and net worth

- Issue: [#185](https://github.com/sirloinbh/money-ledger/issues/185)
- Branch: `feat/185-daily-saves-job`

## Purpose

Due fixed-cost entries, the reports of finished weeks and months, and today's net worth were only saved when the app was opened (#43, #62, #49). A day without an open had no net worth row, and a report or fixed cost waited for the next open.

## Decision (user, 2026-11-22)

Both: a daily pg-boss job on the server does the three saves, and the app keeps its on-open calls as an idempotent fallback. Recorded on the issue.

- Times (Asia/Seoul): 00:05 adds the day's fixed costs and the reports of the period that just ended. 19:05, after the daily price fetch (12:00–18:00), saves the net worth again with the day's prices. Both runs do all three steps; each is safe to repeat.
- Unchanged from #49: today's row is replaced by each save (the job, the app opening, "Save current values"). Days before the job existed are not filled in, and no back-fill is done.

## Changes

- `backend/src/daily-saves.ts` (new)
  - `dailySavesQueue(pool)`: the queue `daily-saves`, in the style of the price queue. It uses the `singleton` policy (one run at a time), the cron `5 0,19 * * *` in Asia/Seoul, and 2 retries 60 seconds apart.
  - `runDailySaves(day, work)`: fixed costs, then reports, then net worth. A failed step is logged (`daily_save_failed`) and the others still run. The exception: reports wait for fixed costs (`daily_save_skipped`), so a report never misses a due entry, as in the app (#204). The job fails at the end when a step failed, so pg-boss runs it again.
- `backend/src/server.ts`: registration only. The queue is added to the list that `startJobs` receives; start and retry stay in `runtime.ts` (#235).
- Exports for the job, with the code unchanged:
  - `addDueFixedCosts(pool, today)` in `fixed-costs.ts`, which `POST /generate` now uses too.
  - `generateReports` in `reports.ts`.
  - `saveNetWorth` in `net-worth.ts`.
- `frontend/src/app.tsx`: a comment only. The on-open calls stay and are the fallback.

## Verification

- `backend/test/daily-saves.test.ts` (new, fake steps):
  - The queue name, the cron, the policy and that it retries.
  - The order: fixed costs → reports → net worth, all for the service date.
  - A failed fixed-cost step skips the reports, still saves the net worth, logs both, and fails the job.
  - A failed report or net worth step does not stop the other.
- `backend/test/daily-saves.integration.test.ts` (new, real DB). On Sunday 2026-11-08, with an October expense, rent due on the 1st and a bank account, running the handler twice gives:
  - one rent entry on 2026-11-01;
  - the October report (30,000) and the Nov 1–7 week report, which already counts the rent (500,000);
  - one net worth row for 2026-11-08 (2,000,000).
- Local, test DB `postgres:17-alpine` with every migration applied, `TEST_DATABASE_URL` set:
  - `tsx --test --test-concurrency=1` on the daily-saves, fixed-costs, reports and net-worth integration tests: 34 pass, 0 fail, 0 skipped.
  - `npm run check` and `npm run knip`: see the PR body.
- No browser check: no screen changed.

## Limits

- A server that is off at 00:05 and 19:05 does not catch up when it starts; the app's on-open calls cover that day.
- The job's status is in `GET /api/jobs/status` with the price queue.
