# #201 Respect hidden categories in fixed costs and show the right month

- Issue: [#201](https://github.com/sirloinbh/money-ledger/issues/201)
- Branch: `fix/201-fixed-costs-hidden-month`
- Parent: #88 Ledger input automation and category management

## Purpose

The code review on 2026-11-18 found that fixed costs accepted a hidden category and kept adding entries into it, that `POST /api/ledger/fixed-costs` answered a different shape from the list, that a variable item's estimate could come from an entry changed to income, and that the fixed-cost card showed one month's data under another month's name.

## Changes

### Backend (`backend/src/fixed-costs.ts`)

- Create and change check the category inside the transaction with `SELECT … FOR SHARE`: a missing or income category is still `422 Choose an expense category`, and a hidden one is `422 Choose a category that is not hidden`. Like entries, an item may keep the category it already has after that category is hidden; only a new choice is checked. The change now runs in one transaction (`FOR UPDATE` on the item).
- Generation skips items whose category is hidden. Their due months get no run row, so once the category is shown again, or the item moves to a visible category, the months it missed are added, following the existing rule "every due month without a run gets its entry".
- Each item has `categoryHidden` so the screen can say why nothing is added.
- `POST /` answers the same item shape as the list (`categoryName`, `categoryHidden`, `entry: null`), read inside the create transaction.
- A variable item's estimate reads only confirmed entries that are still `kind = 'expense'`.

### Frontend (`frontend/src/fixed-costs.tsx`)

- The card shows data only when its `month` matches the month in the URL. While another month loads it shows "Loading fixed costs"; after that load fails it shows only the error and "Try again", not the previous month.
- A preset whose default category (for example `주거`) is not there, because it was renamed or hidden, clears the category choice and shows "There is no category named 주거. Choose a category below." (also linked to the select through `aria-describedby`). Choosing a category removes the hint.
- An item in a hidden category has a "Category hidden" badge and, while active, the line "No entries are added while <name> is hidden. Choose another category or show it again."

## Verification

Tests added or changed:

- `backend/test/fixed-costs.integration.test.ts`
  - "create answers the same item shape as the list": the `POST` answer deep-equals the list item.
  - "a hidden category is refused and gets no new entries": create and a move into a hidden category are refused; an item whose own category is hidden later can still be renamed, adds nothing, reports `categoryHidden`, and gets its two missed months once the category is shown again.
  - "the estimate skips a confirmed entry that was changed to income": November starts from September's confirmed amount, not October's entry that became income.
- `frontend/src/fixed-costs.test.tsx`
  - "another month never shows the previous month, while it loads or after it fails" (fails on the old code: November's list stayed under October).
  - "a preset whose category was renamed asks for a category".
  - "an item in a hidden category says no entries are added".

Commands (local, test DB `postgres:17-alpine` with every migration applied, `TEST_DATABASE_URL` set):

- `tsx --test test/fixed-costs.integration.test.ts`: 13 pass, 0 fail, 0 skipped.
- `vitest run src/fixed-costs.test.tsx`: 11 pass.
- `npm run check`: pass (backend 414 pass / 0 fail / 0 skipped; frontend 70 files, 459 pass, 3 skipped that were skipped before this change; skills 4 pass; build ok).
- `npm run knip`: pass (only the existing configuration hints).

Browser check (local API 3195 and Vite 5295, dev DB with `주거` renamed to `Home` and `통신` hidden):

- 390×844: the Rent preset shows the hint and leaves the category on "Choose"; no horizontal scroll (scroll width 375).
- 1440×900: the Phone item in the hidden `통신` shows the badge and the line; the form hint shows; no horizontal scroll.

## Limits

- Presets still match the default Korean names; a renamed category is not guessed, the user chooses it.
- Months skipped while the category was hidden are added when it is shown again. If that turns out to be unwanted, stopping the item before showing the category again keeps them out (starting again begins at the current month).

## Review

- Round 1 ([PR comment](https://github.com/sirloinbh/money-ledger/pull/238#issuecomment-7078092407)): approve, no blocking comments. One non-blocking nit (presets match default names), already under Limits.
