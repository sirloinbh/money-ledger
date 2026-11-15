# #50 Create and reset a mock investing account

- Issue: https://github.com/sirloinbh/money-ledger/issues/50
- Branch: `feat/50-mock-account`

## Purpose

Let the user create a mock investing account with virtual money, check the balance, and start over from the beginning (reset). Orders (#52), holdings and returns (#53), and trade history and trend (#54) are out of scope.

## Decision (confirmed by the user on 2026-11-03, recorded in an issue comment)

- Initial funds: the default is 10 million won, and a direct input is possible. (The input range of 10,000 won to 10 billion won is not a user decision; we set it in the implementation.)
- Number of accounts: one. A partial unique index in the DB limits open accounts to one.
- Earlier records at reset: we keep them and do not delete them. The done criterion in the issue, "the related data is deleted in one transaction", was implemented to fit this decision as "closing the current account (`closed_at`) and opening a new account is handled in one transaction". Once orders and holdings exist (#52, #53), they are tied to the account ID, so they do not follow into the new account.
- Cash is held only in won (`bigint`). Whether dollar cash is needed for US stock orders is decided in the order issue (#52) and the price source (#36).

## Changes

- `database/migrations/005_mock_accounts.sql`: the `mock_accounts` table (starting amount, cash balance, start and end times). CHECKs on the range of the starting amount and balance, and a partial unique index that allows only one open account. It is safe to run again.
- `backend/src/mock-accounts.ts`: `GET /api/mock/accounts` (the open account and the latest 20 closed accounts, read at the same moment with one query), `POST /api/mock/accounts` (create an account, 409 if one exists), and `POST /api/mock/accounts/:id/reset` (reset). The reset receives the account ID the screen showed, and closes it and opens a new account only if that account is still open. Pressing twice or resending from an old tab gives 409, and a nonexistent account gives 404. If it fails halfway, it rolls back.
- `frontend/src/mock-account.tsx`, `frontend/src/mock-trading.tsx`: the mock investing screen. With no account, a starting amount input (default 10,000,000) and "계좌 만들기" ("Create account"); with an account, the cash balance, the starting amount, the start time, and "처음부터 다시 시작" ("Start over"). A reset checks the amount first and then opens a confirmation dialog. A closed account stays in the "이전 계좌" ("Previous accounts") list. We show a note that virtual amounts are not included in the ledger and portfolio totals.
- `frontend/src/format.ts`: `withoutThousands`, which removes only three-digit commas (moved from an internal function of the asset screen), and `formatDateTime`, which displays a time in the service time zone.

## Verification

- Test DB: we set a disposable `postgres:17-alpine` container (migrations 001 to 005 applied automatically) as `TEST_DATABASE_URL`.
- `npm test` (backend): 87 passed, 0 skipped. The new DB integration tests check creating with the default 10 million won and a duplicate 409, keeping the previous account after a reset, re-resetting an already closed account 409 and a nonexistent account 404, only one of 2 simultaneous resets succeeding, a rollback when the new account INSERT fails, the DB CHECKs and unique index, and the mock account not entering the portfolio total.
- `npm test -- src/mock-account.test.tsx src/app.test.tsx src/format.test.ts src/assets.test.tsx` (frontend): 43 passed.
- `TEST_DATABASE_URL=<test DB> npm run check` passed: backend 87 passed (0 skipped), frontend 125 of 127 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Browser: we connected the API to the test DB and checked `/mock-trading` at 390×844 and 1440×900 with headless Chrome (viewport set through CDP). No horizontal overflow at either size (scrollWidth = clientWidth). From the empty screen, creating an account with the default 10,000,000 moves focus to the "모의투자 계좌" ("Mock investing account") heading, and resetting with 30,000,000 shows the current cash and the new amount in the confirmation dialog. After confirming, focus returns to the "초기화" ("Reset") button and the previous account stays in the list.
- The local `npm run knip` does not run because the oxc-resolver native binding is missing (the same as #45). We check it in CI.

## Limits and follow-up

- Returns, holdings, and orders are #52 to #54. The price source is #36 (waiting for the user's decision).
- Closed accounts show only the latest 20.

## Review record

### Round 1: no defect blocking the merge, 4 addressed

- If "계좌 만들기" gave a 409 because an account was already created in another tab, the form turned into the account card and focus fell to the page body. If focus was lost after reloading, we move it to the account heading.
- If the create form appeared because of a 404 (no account) during a reset, the button for the dialog to return to disappeared. We close the dialog first and send focus to the amount field of the create form.
- `GET` read the open account and the closed accounts with two queries, so if a reset committed between them, different moments could be mixed. We merged them into one query.
- Doc: the range of 10,000 to 10 billion won read like a user decision, so we corrected it to say it is a value set in the implementation.
- Tests added: focus on the heading after a create 409, focus on the amount field after a reset 404, and a DB integration test that only the latest 20 of 25 closed accounts come back.
- Not addressed: a reset 500 error showing in the notice behind the dialog is the common behavior of the central `ConfirmDialog` and out of scope for this PR. We did not add a test that the ledger total excludes it, because the mock account is not connected to `ledger_entries` in the structure. The "이전 계좌" heading style is the same default style as the list heading (`h2`) on the asset screen.
- Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 88 passed and 0 skipped, frontend 126 of 128 passed and 2 skipped (existing), 4 skill tests).

### Round 2: 4 first-round fixes confirmed, no blocking defect, no further fixes

- The focus after a create 409 and a reset 404, the one-query read, and the doc wording were all fixed correctly. Whichever finishes first, the dialog close animation or the reload, focus goes to the amount field. In the success, cancel, and 409 flows, it returns to the reset button.
- Note (not addressed): if the create and the reload that follows both fail, the focus flag stays on. The next load happens only in the create flow and moves focus only when it was lost, so there is no real symptom.
- By the standard, we do not run a third review.
