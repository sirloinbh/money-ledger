# #76 Block cancel while a category name saves

- Issue: https://github.com/sirloinbh/money-ledger/issues/76
- Branch: `fix/76-category-rename-cancel`

## Purpose

In the category rename form, "Cancel" still worked while the new name was being saved. Pressing it during the save closed the form first, and if the save was then refused (for example a duplicate name, 409), only the error showed and the typed name was gone. PR #66 had covered this but was closed without merging.

## Changes

- `frontend/src/categories.tsx` (`CategoryRow`)
  - A `renaming` state is on from the moment the rename is sent until it ends, success or failure.
  - While it is on, the Cancel button has `aria-disabled="true"` and the same look as other `aria-disabled` buttons (`entries.tsx`: no pointer events, half opacity). It is not `disabled`, so keyboard focus stays on it. Pressing it does nothing.
  - Escape in the name field cancels the edit, like Cancel, and is ignored while the save is in progress. The handler is on the input, not the form, because the a11y lint rule refuses key handlers on a non-interactive element. Focus returns to the rename button as before.
- `frontend/src/categories.test.tsx`: two tests.
  - Escape closes the form, sends nothing, and focus returns to "Rename Food".
  - With the PATCH held, Cancel is `aria-disabled`, Cancel and Escape keep the form, its value, and focus. After the server refuses the name (409), the alert shows, the form keeps the typed name, only one PATCH was sent, and Cancel works again.

## Verification

- `npm run test --workspace frontend -- src/categories.test.tsx`: 12 passed.
- The same file with `categories.tsx` reverted to main: the two new tests failed (2 failed, 10 passed), so they catch the bug.
- Browser: headless Edge (DevTools protocol script) on the local app (API on a test DB, Vite), at 390×844 (mobile emulation) and 1440×900. The script held the PATCH, renamed 식비 to the existing 교통, then pressed Cancel and Escape during the save.
  - Both sizes: during the save, Cancel had `aria-disabled="true"`, opacity 0.5, no pointer events, and kept focus; the form stayed open with 교통 and one PATCH was sent.
  - After release: the alert "A category with this name already exists for this kind" showed above the cards, the form kept 교통, and Cancel was enabled again. No horizontal scroll at 390 (page width 390).
  - Not checked in a real (headed) browser: the Claude in Chrome extension was not connected.

### First review (PR #139)

- No blocking issues.
- Fixed: Escape that ends a Korean IME composition (`isComposing`) no longer cancels the edit and drops the name, the same guard as `combobox.tsx`. The Escape test also covers that, and that reopening starts from the saved name.
- Note: Save is not blocked during the save. A second submit sends nothing because of the existing `saving` ref in `CategoryManager`, which is what keeps it to one PATCH.
- Not taken: a "Saving" live-region message (not in the done criteria).

### After the first review

- `npm run check` (with `TEST_DATABASE_URL` unset): passed. Frontend 315 tests: 313 passed, 2 skipped. Backend 173 passed, 16 DB tests skipped (no backend change).
- `npm run knip`: passed.

### Second review (PR #139)

- Nothing to fix. The `isComposing` guard matches `combobox.tsx`, and the test sets `nativeEvent.isComposing` through jsdom's `KeyboardEvent`, so it exercises the guard. The double-submit note is already covered by the `saving` ref above.
