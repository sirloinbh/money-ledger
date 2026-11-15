# #55 Summary dashboard

The first screen (`/`) shows this month's ledger, the latest net worth, and the mock account at a glance, instead of an empty page.

## What changed

- `frontend/src/dashboard.tsx`: `DashboardPage` with three cards, mounted on `/` in `frontend/src/app.tsx`.
  - **This month**: income, expense, and balance of the current month (Asia/Seoul), from `GET /api/ledger/summary?month=`. The link opens `/ledger?month=<this month>`.
  - **Net worth**: the latest saved day (net worth, assets, liabilities, and how many items had no value), from `GET /api/portfolio/net-worth`. It waits for today's save when the app opens (`saveTodayOnce`), like the portfolio page. The link opens `/portfolio`.
  - **Mock trading**: total assets, gain/loss, and return of the open mock account, from `GET /api/mock/accounts` and its holdings. The card says "Practice money, not part of your net worth". The link opens `/mock-trading`.
- Each card loads on its own. A failed card shows "Could not load this card." with a retry button, and the others are still shown.
- Each card has its own empty state: no income or spending this month, no net worth saved, or no mock account.
- Each card is a labelled region with an `h2` title, so a screen reader can jump between them.

## Choices made here

- No new API: each card calls the same endpoint as its own page and formats values the same way, so the numbers match that page by construction. Three small requests at open are cheap for one user.
- Totals only, no charts: the charts stay on their pages. The link on each card is the way there.

## Verification (2026-11-16)

- Screen tests (`frontend/src/dashboard.test.tsx`, 3): values, links, and the mock card's note; one failing card with the others shown and a retry; empty states for all three. `app.test.tsx` still passes.
- `npm run check` passed: frontend 342 passed and 2 skipped; backend 173 passed and 18 DB tests skipped (no backend change). `npm run knip` passed.
- Browser check: headless Edge over the DevTools protocol, with the API and Vite running against the test DB.
  - With no entries and no mock account, the ledger and mock cards showed their empty states. The net worth card showed the day saved at open (₩0, with one item without a value).
  - After adding an income of ₩3,000,000, an expense of ₩12,500, and a mock account of ₩10,000,000, the cards showed ₩3,000,000 / ₩12,500 / ₩2,987,500 and ₩10,000,000 / ₩0 / 0%.
  - "Open the ledger" opened `/ledger?month=2026-11`, whose summary showed the same ₩3,000,000 / ₩12,500 / ₩2,987,500.
  - At 390×844 the cards stack; at 1440×900 they sit in three columns. Page width was 390 and 1425 (no horizontal scroll).

### First review (PR #146)

- No blocking issues; values and labels match the pages. Fixed in this PR:
  - The ledger card takes the month once, so its title, link, and totals stay the same month if the page is left open past midnight at a month's end.
  - "Loading" is a status message, so a screen reader announces it.
- Tests added: the month in Seoul time (15:30 UTC on Nov 30 is December); a mock loss with signs, a missing total shown as `-`, and a failed holdings request that loads on retry.
- Not changed: the `signedWon` helper now exists in five files; merging them into `format.ts` is a cleanup outside this PR. A month with only ₩0 entries shows the empty state, which fits "nothing to summarize".
- After the fixes: `npm run check` passed (frontend 344 passed / 2 skipped) and `npm run knip` passed. The layout did not change, so the browser check was not repeated.

### Second review (PR #146)

- Nothing to fix: the card loads once and once per retry, title, link, and totals share one month, and the new tests exercise the Seoul rollover and the mock retry without timer flakiness.
