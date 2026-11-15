# Household ledger, assets, and mock investing: project-specific instructions

This file holds rules that apply only to money-ledger. The shared instructions are in [AGENTS.md](AGENTS.md), which becomes a centrally managed file after the central standards sync (`sirloinbh/project-standards`). If the two files differ, this file wins.

## Work procedure (in addition to the shared procedure)

- **After you open a PR, it goes through automatic code review at most 2 times, and when all required CI checks of the final head pass, the agent (the main agent or a local worker) merges without asking.** If the review finds something to fix, address it in a follow-up commit, and after the first round of fixes get one more review. After the second round of fix commits, do not review again. If nothing needs fixing, go straight to the next step. Split a fix that is too big for this PR into a new issue card. The detailed procedure follows the implementation skill. To merge, run `pr merge <url> --merge --match-head-commit <verified head SHA>` (merge commit) with the project wrapper, and check that the linked issue (`Closes #N`) is closed. Merge stacked PRs in order. After the earlier PR is merged, merge `origin/main` into the next PR branch to resolve conflicts, rerun the related tests, push normally, wait for CI to pass, and merge. Do not merge a PR that has failing or running checks, bypass branch protection with `--admin` or similar, replace a review by approving your own PR, commit or push directly to `main`, or force-push. Merging to `main` does not trigger a deployment right now (deployment is not connected).

## Project-specific skills

- [money-ledger-implementation](skills/money-ledger-implementation/SKILL.md), [money-ledger-testing](skills/money-ledger-testing/SKILL.md), [money-ledger-foundation](skills/money-ledger-foundation/SKILL.md): they hold this project's review and merge procedure, so keep them even after the shared skills (std-*) arrive.

## Service rules

### Quantity, foreign currency, and exchange rate (user decision on 2026-11-03, #35)

On top of the amount rules in the central `docs/conventions/domain.md` (whole won, `bigint`), stock quantities and foreign currency are handled as follows. The central doc is updated in [project-standards#401](https://github.com/sirloinbh/project-standards/issues/401).

| Value          | Storage (PostgreSQL)                                | API value                     | Range                                       |
| -------------- | --------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| Currency code  | `text`, `CHECK (currency IN ('KRW', 'USD'))`        | `'KRW' \| 'USD'`              | Only two currencies at first                |
| Quantity       | `numeric(20,8)`                                     | Decimal string `"0.12345678"` | `CHECK (quantity > 0)`                      |
| KRW amount     | `bigint` (won)                                      | Integer number                | The central amount rule as is               |
| Unit price     | `numeric(20,4)` + `currency` on the same row        | Decimal string `"123.4500"`   | `CHECK (price > 0)`                         |
| Foreign amount | `numeric(20,4)` + `currency` on the same row        | Decimal string `"123.4500"`   | `CHECK (currency <> 'KRW' AND amount >= 0)` |
| Exchange rate  | `numeric(12,4)`, KRW per 1 unit of foreign currency | Decimal string `"1385.2500"`  | `CHECK (fx_rate > 0)`                       |

- The unit price is stored in one column (`numeric(20,4)`) plus `currency` regardless of currency, and it is a decimal string in the API too. A unit price with `currency = 'KRW'` must have nothing after the decimal point (`CHECK (currency <> 'KRW' OR price = trunc(price))`).
- A KRW amount is always `bigint`. A `numeric(20,4)` amount column (such as a foreign currency deposit balance) is USD only and does not hold KRW amounts. An amount that can be either KRW or foreign is split into two columns: `amount_krw bigint` and `amount_foreign numeric(20,4)`.
- `numeric` values are sent and received as strings in the API. Do not convert them to JavaScript `number` (floating point) for calculation. Do multiplication, sums, and rounding with SQL `numeric` operations. Input validation checks the number of digits (integer and fractional parts) with a Zod regular expression.
- A trade row stores the quantity, the unit price, `currency`, the exchange rate (`fx_rate`), and the KRW trade amount (`amount_krw bigint NOT NULL`). The exchange rate is `NULL` for KRW, and for USD the trading-day exchange rate must be set (`CHECK ((currency = 'KRW') = (fx_rate IS NULL))`). Even if the exchange rate changes later, the KRW amount of the trade record does not change.
- The KRW trade amount is computed once, when it is stored: `amount_krw = round(quantity × unit price × coalesce(fx_rate, 1))`. Do not round an intermediate result such as the foreign currency total first.
- The foreign currency trade total is not stored; compute it when needed as `quantity × unit price`. A value to show on screen is produced in SQL as `round(quantity × unit price, 2)` (cents) and sent. Do not round on screen with `Number(...).toFixed()`.
- Valuation (current value) is converted to KRW at the latest exchange rate at query time: `round(quantity × current price × latest exchange rate)`. The price and exchange rate sources and the update cycle follow [docs/price-source.md](docs/price-source.md) (#36): use the closing price fetched once a day and the Korea Eximbank basic rate. The trading-day exchange rate of a mock order is the latest basic rate stored at order time.
- Rounding uses PostgreSQL `round(numeric)`, which rounds 0.5 away from zero (`round(2.5) = 3`, `round(-2.5) = -3`). All operands must be `numeric`. If `double precision` gets mixed in, it switches to round-half-to-even. Do not substitute JS `Math.round`, which turns -2.5 into -2.
- Totals add up KRW-converted amounts. Do not add foreign amounts of different currencies as they are.
