# All-in buy at the best ask with fees and a day trade or long hold strategy (#307)

Steps 3 and 4 of mock investing v2 ([#303](https://github.com/sirloinbh/money-ledger/issues/303)). Stacked on #305 (`feat/305-kis-live-prices`): the best ask and best bid come from `liveQuote()`.

## Changes

| File                                                 | Change                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `database/migrations/041_mock_positions.sql`         | `mock_orders.tax_krw` and `fill_source` (`close` or `book`); new `mock_positions` (strategy, when and how it was chosen, buy and sell order)                                                           |
| `backend/src/mock/positions.ts`                      | All-in quantity in SQL, `GET/POST /api/mock/accounts/:accountId/positions` (+ `/preview`), `POST /api/mock/positions/:id/strategy`, and `sellPosition()` (best bid, commission, tax) for #309 and #310 |
| `backend/src/mock/orders.ts`                         | Order history also returns `taxKrw`                                                                                                                                                                    |
| `backend/src/mock/accounts.ts`                       | A new account gets the v2 commission rate 0.015%                                                                                                                                                       |
| `backend/src/app.ts`, `openapi.ts`                   | Two mount lines, four operations                                                                                                                                                                       |
| `frontend/src/mock-all-in.tsx`, `mock-positions.tsx` | "Review all-in buy" on the order form of a Korean security (one line in `mock-order.tsx`); Positions card with Day trade and Long hold buttons (one line in `mock-trading.tsx`)                        |

## Rules

- All-in quantity = the most whole shares with `q × ask + round(q × ask × fee_rate) <= cash`, found in SQL `numeric` (the exact division, then the share before and after it, because the fee rounds to whole won).
- Buy: fills at the best ask; the screen sends the ask it showed and the server refuses with 409 if it moved. Sell: fills at the best bid, `fee = round(amount × fee_rate)`, `tax = round(amount × 0.0020)`, cash gained = amount − fee − tax. Closed market, no quote, or quantity 0 are refused with nothing saved.
- A position starts `undecided`; `POST .../strategy` sets `day_trade` or `long_hold` once (`source` `web` or `kakao`; `auto` is for rules, internal). The same choice again is a no-op; another choice or a sold position is 409.
- The close-price order path is unchanged (rows keep `fill_source = 'close'`, tax 0). Existing accounts keep their fee rate.
- A sale uses the average-cost holding update of the old path. The position and the holding are separate records: a close-price sale of the same stock can leave too few shares, and `sellPosition()` then refuses with 409.

## Choices made without asking

- **Transaction tax 0.20% of the sale amount** (KOSPI 0.05% tax + 0.15% rural development special tax; KOSDAQ 0.20%), from news reports of the 2026 tax law revision (for sales from 2026-01-01). No official page (law.go.kr, NTS, MOEF) was reachable from the search tool, so this is **not confirmed against an official source**. It is one constant, `SALE_TAX_RATE` in `positions.ts`; KONEX (0.10%) is not handled. Say so if you want it changed.
- **The 0.015% rate applies to accounts created from now on**, not to existing accounts (no way to tell which is "v2"), set in `accounts.ts`. Existing accounts can be changed with SQL.
- **Positions are a new table and new endpoints** instead of changing the old order endpoint, so the close-price path stays as it was.
- The ask is checked against what the screen showed (409 "The best ask changed") like the close-price path does, even though live asks move more often.

## Checks

- DB integration tests on a dedicated test DB (Postgres 17, `money_test`), none skipped: `mock-positions.integration.test.ts` covers the fee edge (981,547 won buys 14 shares, 981,546 buys 13; a fee that rounds up), the buy, replay with the same key, closed market, changed ask, too little cash, halted and US securities, 503 without live prices, strategy changes (twice, other choice, sold, unknown, invalid), the sale with fee and tax in SQL (980,000 − 147 − 1,960), a second sale, a sale in a closed market, the old order path, and the new account fee rate. Seven other DB test files got `mock_positions` in their DROP lists.
- Frontend: `mock-positions.test.tsx`, `mock-all-in.test.tsx`.
- Browser check with the fake source (`PRICE_SOURCE=fake`, API 3196, Vite 5296, test DB), Samsung Electronics:
  - 390×844: Review all-in buy → "Buy 142 shares… best ask ₩70,100 · ₩9,954,200 · fee ₩1,493 · cash after ₩44,307"; after buying, the Positions card shows the position as Undecided with both buttons; Long hold saves "Chosen … (web)" and removes the buttons. No horizontal scroll (page width 390).
  - 1440×900: same card, no overflow (page width 1440).
  - The only console errors were 403s for Pretendard font files (the worktree's `node_modules` link points outside Vite's allowed folders), as in #305.
- Real KIS key not checked: waiting on #304.
