# #35 Storage rules for stock quantity, foreign currency, and exchange rate

- Issue: [#35](https://github.com/sirloinbh/money-ledger/issues/35)
- Branch: `docs/35-quantity-currency-rules`

## Purpose

Before implementing the portfolio (#45) and mock investing (#50), decide the storage format of fractional quantities, foreign currency amounts, and exchange rates, and how they are converted to KRW.

## Changes: 2026-11-03

- Added a "Quantity, foreign currency, and exchange rate" section to the service rules in `AGENTS.project.md`. It describes the column formats and API value formats of currency, quantity, KRW and foreign amounts, and exchange rate, the conversion timing, and the rounding method.
- Registered the issue [project-standards#401](https://github.com/sirloinbh/project-standards/issues/401) for reflecting this in the central `domain.md`.
- Changed #35 to confirmed in `docs/next-steps/README.md`.

## Decision

The user confirmed the recommendation in the issue as it was (2026-11-03, [issue comment](https://github.com/sirloinbh/money-ledger/issues/35#issuecomment-6596782086)).

- Only KRW and USD are handled.
- Quantity is `numeric(20,8)`.
- Foreign amounts are stored with a currency code and `numeric(20,4)`, separately from whole-won integers.
- A trade stores the trading-day exchange rate, and valuation uses the exchange rate at query time.

## Judgment

We decided the details that were not in the recommendation as follows.

- The exchange rate is `numeric(12,4)` (KRW per 1 unit of foreign currency). The KRW/USD rate is quoted with about 4 integer digits and 2 decimals, so we left room.
- The unit price goes in one column (`numeric(20,4)`) regardless of currency, and for KRW the fractional part must be 0. This lets Korean and overseas tickers share the same table.
- `numeric` is sent and received as a string in the API. pg returns `numeric` as a string, and converting to a JS `number` would lose the precision of `numeric(20,8)`.
- KRW conversion is rounded once at the end with `round(numeric)` (0.5 away from zero). If intermediate roundings pile up, the totals drift.
- Every trade row stores the KRW trade amount (`amount_krw`), and the exchange rate goes only in USD rows. This keeps the KRW cost basis at the trading-day rate from changing later, and lets us add KRW amounts directly even when currencies are mixed.
- The foreign currency trade total is not stored. If it were, the rounded foreign total and the KRW trade amount could be off by 1 won.

## Verification

- Only docs changed, so we did not add app tests.
- `npm run format:check`, `npm run standards:check`: passed.

## Review record

### Round 1: 5 points, addressed in follow-up commits

- The CHECK that ties KRW unit prices and amounts to integers conflicted with trade amounts multiplied by a fractional quantity. We changed it so the integer CHECK sits only on unit prices and amounts, and the trade amount is stored only in `amount_krw`.
- There was no rounding method for foreign amounts. We wrote that the foreign trade total is not stored, and the KRW trade amount is rounded once from `quantity × unit price × exchange rate`.
- The KRW amount and exchange rate format of KRW rows were missing. We wrote `amount_krw NOT NULL` on every trade row, and a CHECK that the exchange rate is `NULL` for KRW.
- "0.5 rounds up" is wrong for negatives. We corrected it to "away from zero" and said not to mix `double precision` and JS `Math.round`.
- The amount and unit price ranges had no CHECK. We wrote unit price `> 0` and amount `>= 0`.

### Round 2: first-round fixes confirmed, 2 points

- The sentence saying the foreign total is rounded "on screen" contradicted the rule that rounding happens only in SQL. We corrected it so that the display value is also made with SQL `round(quantity × unit price, 2)`.
- A KRW amount could also go into a `numeric(20,4)` column, which made two formats. We corrected it so a KRW amount is always `bigint`, and a `numeric(20,4)` amount column is USD only.
- By the standard, we do not run a third review.
