# #398 Merge Week and 12 weeks into Dashboard

- Issue: [#398](https://github.com/sirloinbh/money-ledger/issues/398) (tracking: sirloinbh/project-standards#1215)

## Changes — 2026-11-28

- The Week and 12 weeks menu items are removed. Dashboard has a "Dashboard view" choice: Summary (the old dashboard), Week, 12 weeks, kept in `?view=` (the Week view still uses `?date=`). A week row in the 12-week view opens the Week view of that week.
- `/week` and `/12-weeks` redirect to `/dashboard?view=week` and `/dashboard?view=12weeks`, keeping `?date=`.
- Tests: `week.test.tsx` uses the two views; `app.test.tsx` checks the redirects.
