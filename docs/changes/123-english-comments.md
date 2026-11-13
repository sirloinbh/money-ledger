# Translate Korean code comments to English (#123)

Issue: [#123](https://github.com/sirloinbh/money-ledger/issues/123), tracked by [project-standards#487](https://github.com/sirloinbh/project-standards/issues/487).

## Purpose

No code comment in this repo is Korean. UI text and test strings are out of scope (the screen-text issue under project-standards#457 covers them).

## Findings

A scan for Hangul in code files found about 86 files, but almost all of them contain Korean only in string literals (UI text, API error messages, test names, and fixtures). Only 11 comment lines in 8 files contained Korean. Centrally managed files (listed in `.standards/manifest.json` or marked as managed) were skipped.

## Changes

- `.env.example`, `compose.yaml`: translated the comments about the price API keys and `PRICE_SOURCE`.
- `database/migrations/002_ledger_categories.sql`: the trailing comments that name the default categories are now English (the `U&` escaped values are unchanged).
- `database/migrations/004_portfolio_assets.sql`, `005_mock_accounts.sql`, `013_asset_trades.sql`, `006_ledger_classification.sql`, and `backend/src/assets.ts`: comments now use English amounts (for example "1,000 trillion won") and refer to the English heading "Quantity, foreign currency, and exchange rate" in `AGENTS.project.md` (translated in #125).

No behavior changed. Only comments were edited.

## Korean kept on purpose

- `database/migrations/006_ledger_classification.sql`: the screen label "미분류" (uncategorized), quoted in a comment.
- `backend/test/entries.integration.test.ts`: `ids['expense/식비']` in a comment is a key that matches the real category name used by the test.
- All Korean string literals, UI text, test names, and fixtures (out of scope).

## Verification

- `prettier --check` (compose.yaml, assets.ts, this record), `eslint --max-warnings 0` on `backend/src/assets.ts`, and the backend typecheck: pass.
- Backend tests without a database (`npm run test -w backend`): 173 passed, 0 failed, 15 skipped (DB integration tests need `TEST_DATABASE_URL`; CI runs them).
- Hangul search over comment lines in non-managed code files: only the two kept items above remain.
