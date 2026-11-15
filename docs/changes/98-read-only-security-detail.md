# #98 Read-only security detail, opening as a POST, and a tracking limit

Before this change, reading a security's detail (`GET /api/prices/securities/:id`) could fetch a US close from Tiingo on the spot and put the ticker on the daily fetch for 30 days. Without a login, anything that walked the ids could do that: a crawler, a link preview, or a script. That could use up Tiingo's free plan of 500 tickers a month.

## Decision

The user chose to make the GET read-only, move fetching and tracking to a POST, and add a monthly cap (2026-11-16, recorded on #98).

## What changed

- `backend/src/prices/router.ts`
  - `GET /api/prices/securities/:id` reads stored data only: the security, its latest stored close, and the USD rate. It makes no call and does not change `viewed_at`. `quoteIssue` is always `null` there.
  - `POST /api/prices/securities/:id/view` is what the screen sends when a detail opens. It does what the GET used to do: it fetches a US close now when needed, fetches a missing name, and tracks the ticker for 30 days. It answers with the same body as the GET.
  - Past the limit, the answer has `quoteIssue: 'tracking_full'` and no call is made. That is the one issue sent even when a stored close exists, because that close will not be updated. The server logs `price_tracking_full`.
- `backend/src/prices/store.ts`
  - `trackOpened` decides and records tracking in one transaction behind an advisory lock, so two opens at once cannot both take the last place.
  - A US ticker that is not tracked yet is added only while fewer than `trackedUsLimit = 450` US tickers are tracked. Tracked tickers are opened in the last 30 days, held as a portfolio asset, or held in the open mock account; the daily fetch uses the same list.
  - A ticker that is already tracked can always be opened, and its 30 days start again. Korean securities are not limited, because KRX is fetched in one call for the whole market.
- `frontend/src/security-search.tsx`: the detail opens with the POST. `tracking_full` shows "Too many US securities are followed right now, so no quote was fetched. Try again in a few days", under "No quote" or under a stored close.
- `docs/price-source.md`: the GET/POST split and the limit.

## Choices made here

- **The cap is 450, not 500:** this leaves room for tickers that join through a portfolio asset or a mock trade. Those paths are not limited, because the user creates them on purpose.
- **What is counted:** all three kinds of tracked tickers, because Tiingo counts every distinct ticker fetched in a month.
- **Moving window:** the cap counts the last 30 days, the same window that tracking uses, rather than a calendar month.
- **No login needed for the POST:** a script could still call it, but it is capped now, and browsers do not send a POST on their own for a preview or prefetch. Real access control comes with the authentication design before any public release.

## Verification (2026-11-16)

- `backend/test/prices.integration.test.ts` (test DB, 38 passed with `prices.test.ts`, none skipped):
  - The existing open-detail cases now use the POST, and the Korean case reads with the GET.
  - New: a GET makes no source call and leaves `viewed_at` empty, and a POST for a missing id is a 404.
  - New: with 450 tracked, a new ticker is neither fetched nor tracked (`tracking_full`); a stored close is still shown with that issue; a tracked ticker still opens and is extended; a day later, after the others drop off, the new ticker is fetched and tracked.
- `backend/test/prices.test.ts`: a malformed id is a 400 for the GET and the POST.
- `frontend/src/security-search.test.tsx`, 14 passed: the detail opens with the POST, and the `tracking_full` message shows with and without a stored close.
- Whole backend suite on the test DB: 365 passed, none skipped.
- `npm run check` passed: frontend 346 passed / 2 skipped; backend 180 passed / 18 DB tests skipped (no test DB in that run). `npm run knip` passed.
- No browser check: the only visible change is one caption line, covered by the screen tests.

### Review (PR #148)

- No blocking findings. The GET and the POST share one answer shape. The cap check and the tracking write run in one locked transaction. Writing `viewed_at` before the fetch does not change the fetch logic.
- Known limit, not changed: the cap counts a moving 30 days, while Tiingo counts distinct tickers in a calendar month. Opening 450 new tickers, waiting for them to expire, and opening 450 more within one month could still go past 500. It takes deliberate heavy use and is closed by the authentication design. If needed, count distinct tickers fetched this month instead.
