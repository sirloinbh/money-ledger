# Add a trade journal to mock trading (#293)

Part of epic #287 (investment journal and income tracking). Issue: <https://github.com/sirloinbh/money-ledger/issues/293>.

## Purpose

Mock trading exists to practice investment decisions, but an order kept no reason. This lets me write why I placed each order, add a later review note, and see both next to the result so far.

## Changes

| Area     | Change                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database | `051_mock_order_notes.sql`: `mock_orders.note` and `mock_orders.review_note` (nullable text, 1 to 1,000 characters when set). Safe to re-run.                                                                                                           |
| Backend  | `POST .../orders` accepts an optional `note`. New `PATCH .../orders/:id/notes` (only the sent fields change; blank text clears). New `GET .../orders/journal` (50 per page, `before` to continue). Order responses now include `note` and `reviewNote`. |
| Frontend | "Why this order (optional)" field in the order form; new "Trade journal" card on the Mock trading page with an inline "Edit notes" form (why + looking back).                                                                                           |
| OpenAPI  | The two new routes and `MockOrderNotesBody`.                                                                                                                                                                                                            |

## Behavior

- The result is computed on the server in SQL `numeric`, never on screen:
  - A buy whose position (#307) was sold shows that position's **realized** net gain; the sale shows the same number.
  - Any other buy shows the gain **if sold at the latest saved close** (and latest rate for USD): `round(quantity × latest close × coalesce(fx, 1)) ??amount ??fee`.
  - A close-price sale (#52) has no result yet: its cost basis is the open question of #295 (realized gain), so it shows "No result for this sale yet" instead of a guess.
- Notes belong to the account in the URL; another account's order is a 404.

## Verification

- `backend/test/mock-journal.integration.test.ts` on the lane test DB (PostgreSQL 17, port 15492): 6 pass, 0 fail, 0 skipped. It covers saving a note at order time, editing, clearing, validation (empty body, 1,001 characters, wrong type, unknown order, other account), the current result of a buy, the realized result on both orders of a position, and a sale without a result.
- `frontend/src/mock-journal.test.tsx` and `mock-order.test.tsx`: the journal list and results, saving notes, the length limit, and the order note being sent trimmed and cleared.
- Browser (Playwright, lane-2 ports 3192/5292, seeded DB): at 390x844 and 1440x900 the journal card and the order note field show, no horizontal scroll, the note field fits inside the viewport (293 px wide at 390, 605 px at 1440), and saving a review note shows it in the list. The only console errors were `503` from the live quote (KIS is not configured locally), unrelated to this change.
- `npm run check`: see the PR.

## Limits

- Notes are plain text, shown as written. No search or filter in the journal yet.
- The journal reads orders of the open account only, like the trade history.
