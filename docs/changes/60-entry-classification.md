# #60 Automatic classification and bulk classification of spending entries

- Issue: https://github.com/sirloinbh/money-ledger/issues/60
- Branch: `feat/60-entry-classification`

## Purpose

Assign a category automatically by merchant name, and classify uncategorized entries at once. This is preliminary work for importing card, Coupang, and KakaoPay entries (#57 to #59).

## Decision (confirmed by the user on 2026-11-05, recorded in an issue comment)

- Classification method: keyword rules. Financial entries are not sent to an external AI. AI classification will be reviewed later in #83.
- What to match: we add an optional "가맹점" ("Merchant") field (50 characters) to entries, and rules match only the merchant.
- Uncategorized: both income and expenses can be saved without a category.
- Decided during implementation: a keyword matches if the merchant contains it, ignoring case. If several rules match, the longer keyword wins (for the same length, the rule created first). Rules of a hidden category are kept but not applied. "Save as rule" in bulk classification is on by default.

## Changes

- `database/migrations/006_ledger_classification.sql`: added `ledger_entries.merchant`, allowed NULL for `category_id` (uncategorized), a partial index for uncategorized, and the `ledger_category_rules` table (keyword, kind, category, kind match through the `(category_id, kind)` foreign key, and keywords unique per kind ignoring case). It is safe to run again.
- `backend/src/rules.ts`: `GET/POST /api/ledger/rules` and `DELETE /api/ledger/rules/:id`. The kind is taken from the category, and a rule cannot be created for a hidden category. The rule matching SQL (`ruleCategorySql`) is shared with the entry API.
- `backend/src/entries.ts`:
  - When `categoryId` is saved as `null` (or omitted), the same SQL statement puts in the category of the rule matching the merchant, and if there is none it leaves it uncategorized. When a category is chosen, the rules are not consulted (the user's choice is not overwritten). The update (`PUT`) is the same.
  - `GET /api/ledger/entries?uncategorized=true`: the uncategorized entries (latest 200).
  - `POST /api/ledger/entries/classify`: classify the chosen entries (at most 200) into one category. In one transaction it takes the category with `FOR SHARE`, gives 400 if any entry has a different kind, and counts entries that are already classified as `skipped` without touching them. With `remember`, it saves a rule for each merchant of the classified entries, and if a rule with the same keyword exists, it changes it to this category.
  - `POST /api/ledger/entries/apply-rules`: apply the current rules only to uncategorized entries.
- `backend/src/db.ts`: the transaction helper `inTransaction`. We changed the mock investing reset (#50) to use it too (same behavior).
- `frontend/src/entries.tsx`: the merchant field, the first category choice "미분류" ("Uncategorized", not required) with a guidance text, and showing uncategorized and merchant in the list.
- `frontend/src/classification.tsx`, `frontend/src/ledger.tsx`: on the ledger screen, an "미분류 내역" ("Uncategorized entries") section (checkboxes, select all, category, save as rule, and "규칙으로 다시 분류", "Reclassify by rules") and a "분류 규칙" ("Classification rules") section (add and delete). When entries, classification, or rules change, the three sections reload together.

## Verification

- Test DB: we set a disposable `postgres:17-alpine` container (migrations 001 to 006 applied automatically) as `TEST_DATABASE_URL`.
- `npm test` (backend): 108 passed, 0 skipped. The new DB integration tests check rule application (the longer keyword first, ignoring case, excluding an empty merchant, a different kind, and a hidden category), keeping a chosen category, applying rules on update, bulk classification (kind mismatch 400, skipping already classified entries, saving a rule and updating an existing rule, applying to the next entry), rejecting hidden and nonexistent categories, reapplying rules changing only uncategorized entries, the rules API (duplicate 409, the same keyword allowed per kind, delete 404), and the DB constraints.
- `npm test` (frontend): 141 of 143 passed and 2 skipped (existing).
- `TEST_DATABASE_URL=<test DB> npm run check` passed: backend 108 passed (0 skipped), frontend 141 of 143 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Browser: we connected the API to the test DB and checked `/ledger` with headless Chrome (viewport set through CDP). No horizontal overflow at either size (scrollWidth = clientWidth).
  - 390×844: after we put a "스타벅스" ("Starbucks") rule and 5 entries through the API, only the Starbucks entry was assigned to food automatically and 4 were uncategorized. When we chose 2 "김밥천국" ("Kimbap Heaven") entries and classified them as food, "2건을 식비(으)로 분류했습니다. 가맹점 1개를 규칙으로 저장했습니다" ("Classified 2 entries as food. Saved 1 merchant as a rule") appeared, uncategorized dropped to 2, and "김밥천국 역삼점 → 식비" ("Kimbap Heaven Yeoksam branch → Food") appeared in the rule list. Focus stayed on the classify button. Long merchant names wrap.
  - 1440×900: after adding a "쇼핑몰 → 생활" ("Shopping mall → Living") rule and pressing "규칙으로 다시 분류", only the 1 shopping mall entry with a long name changed to living, and entries with no merchant stayed uncategorized.
- The local `npm run knip` does not run because the oxc-resolver native binding is missing (the same as #45). We check it in CI.

## Limits and follow-up

- For an entry whose merchant matches a rule, even if you save it as "미분류", the rule puts the category back in. To leave it uncategorized, delete that rule.

- There is no rule edit screen. Delete and create again.
- The uncategorized list shows only the latest 200.
- Reviewing AI classification is #83. Filling in merchants when importing card, Coupang, and KakaoPay entries is #57 to #59.

## Review record

### Round 1: no defect blocking the merge, 6 addressed

- A regression where a chosen category that became hidden was silently saved as uncategorized: the select field shows "다시 고르세요" ("Choose again"), and recording as it is is blocked with "고른 카테고리를 쓸 수 없습니다. 카테고리를 다시 고르세요" ("The chosen category cannot be used. Choose a category again"). If you choose uncategorized directly, it is saved.
- The same list was loaded twice for one save, classification, or rule change: the section that announced the change skips once even when the version changes, and reloads only once for its own status text.
- If the kind or merchant of the same entry changed and committed during "규칙으로 다시 분류", a foreign key violation 500 could happen: we compare the kind and merchant of the row being updated again.
- "Save as rule" silently changed existing rules: we count new rules (`rulesAdded`) and changed rules (`rulesUpdated`) separately and announce them separately on the screen. A rule that is already the same category is neither touched nor counted.
- We changed the skipped count text to "이미 분류되었거나 바뀌어 건너뛰었습니다" ("Skipped because already classified or changed").
- We add `aria-invalid` to the category error of bulk classification.
- Tests added: blocking a record after a hidden choice and choosing uncategorized directly (frontend), loading only once, the changed rule and skipped text, kind mismatch display, 0/0 when saving the same rule again, and not touching an entry whose kind changed during reclassification (DB integration, reproduced with a row lock).
- Not addressed: that a rule for a hidden category can be created if hiding commits at the same moment (no harm, because the apply step filters out hidden categories), and that the category list is loaded separately by each section (optimizing the number of requests is outside this PR).
- Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 109 passed and 0 skipped, frontend 144 of 146 passed and 2 skipped (existing), 4 skill tests).

### Round 2: 5 first-round fixes confirmed, no blocking defect, 6 addressed in the second-round fix commit

- The rule list did not follow category renames and hiding: when a category changes, the rule list is reloaded too.
- If the entry being edited was classified in the "미분류 내역" section below, saving put it back to uncategorized: if the category changed in the reloaded list, we reflect it in the form and announce it (if the user already chose another category, we leave it). We do not move focus.
- "다시 고르세요" wrongly appeared before the categories were loaded: we judge only after loading. The error display also stays only in that state.
- Two overlapping bulk classifications arriving at the same time could deadlock: we lock rows first in id order.
- The reclassification race test relied on a fixed 300 ms wait: we now check until the lock wait is visible, then commit.
- We left a comment that the premise of `skipReload` (the parent passes down the raised version again) and `xmax = 0` are PostgreSQL implementation details.
- Tests added: saving an edit of an entry classified elsewhere, display before the categories load, and reloading the rules when a category changes.
- By the standard, we do not run a third review.
