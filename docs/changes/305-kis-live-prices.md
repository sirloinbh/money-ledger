# Live prices and the order book from KIS (#305)

Step 3 of mock investing v2 ([#303](https://github.com/sirloinbh/money-ledger/issues/303)): read a Korean stock's live price and 10-level order book.

| File                                   | Change                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/prices/kis.ts`            | KIS client with `fetch`: one cached token (renewed 5 minutes early, single request at a time, one retry on an expired token), quote parsing, errors |
| `backend/src/prices/kis-fake.ts`       | Deterministic fake for tests and `PRICE_SOURCE=fake`; symbol `999999` is always market closed                                                       |
| `backend/src/mock/quotes.ts`           | `GET /api/mock/quotes/:securityId` (active Korean securities only)                                                                                  |
| `backend/src/app.ts`, `server.ts`      | `kis` option, one route line, one wiring line                                                                                                       |
| `frontend/src/mock-order-book.tsx`     | Order book on the mock order form: asks above, bids below                                                                                           |
| `docs/price-source.md`, `.env.example` | "Live prices (KIS)" section; `KIS_APP_KEY`, `KIS_APP_SECRET`                                                                                        |

The KIS endpoint table is **not confirmed against a real account** (waiting on #304); it is marked Secondary in `docs/price-source.md`.

## Checks

- Browser check with the fake source (`PRICE_SOURCE=fake`, API 3191, Vite 5291, test DB), Samsung Electronics order form under Mock trading:
  - 390×844: 10 ask rows (highest first) above 10 bid rows, the best ask next to the best bid, "Last ₩70,000 · read at 20:48:52 KST", no horizontal page scroll (page width 390).
  - 1440×900: same table, no overflow, the order form below it.
  - The only console errors were 403s for Pretendard font files, because the worktree's `node_modules` link points outside Vite's allowed folders. Not related to this change.
- Real KIS key not checked: waiting on #304.
- Unit tests (`backend/test/kis.test.ts`): token cache, single shared token request, renewal 4 minutes before expiry, one retry after `EGW00123`, parsing a recorded-shape answer, market closed, bad key, rate limit, server failure, no secret in errors, the route (503, 400, 404, 409, 200). Frontend: `mock-order-book.test.tsx`.
