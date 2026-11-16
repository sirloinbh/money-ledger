# #154 Suggest categories from past classifications of the same merchant

The uncategorized list now suggests a category for an entry whose merchant was classified before. Nothing leaves the app. This is the "history first" step chosen in #83 ([docs/ai-classification.md](../ai-classification.md)).

## Decisions (user, 2026-11-16, recorded on #154)

- **Matching:** normalized names or a prefix; no `pg_trgm`. A past merchant matches when the normalized names are equal, or when one starts with the other (at least 2 characters). Normalizing drops:
  - letter case
  - bracketed parts such as `(주)`
  - a trailing branch word ending in 점 or 지점
  - digits, spaces, and punctuation
- **Display:** each entry shows its suggestion with a **Use** button, and **Apply N suggestions** applies every shown suggestion.
- **Rules:** accepting a suggestion classifies the entry only and saves no keyword rule.
- **Defaults chosen without asking:**
  - Only categories that are visible and of the same kind are suggested.
  - The same merchant name beats an equal normalized name, which beats a prefix match.
  - Within the closest match, the category used most often wins, then the one used most recently. "from" names that category's most recent merchant.

## What changed

- `backend/src/suggestions.ts`: `merchantKey` (normalizing), `suggest` (matching and choice), and `loadHistory` (classified entries grouped by kind, merchant, and category; hidden categories left out).
- `backend/src/entries.ts`:
  - `GET /api/ledger/entries/suggestions` returns `{ suggestions: [{ entryId, categoryId, categoryName, from }] }` for the same entries as the uncategorized list.
  - `POST /api/ledger/entries/apply-suggestions` takes `{ entryIds }` (1 to 200, like `/classify`) and returns `{ classified, skipped }`. In one transaction it locks the entries, works out the suggestions again, and sets them only on entries still uncategorized whose category is visible and of the same kind. The categories are held `FOR SHARE`.
  - The `entryIds` schema is now shared by `/classify` and `/apply-suggestions`.
- `frontend/src/classification.tsx`:
  - A "Suggested: <category> (from <merchant>)" line and a **Use** button under each entry. They sit outside the checkbox label, so the checkbox keeps its own name. Each button's name includes the merchant, amount, and date, so two entries from the same merchant on the same day can be told apart.
  - An **Apply N suggestions** button next to "Reclassify with rules".
  - If the suggestions fail to load, the list and the form still work without them.

## Verification (2026-11-17)

- `backend/test/suggestions.test.ts`, 5 passed. They cover:
  - normalizing: branch words, brackets, `㈜`, digits, and punctuation; a single word ending in 점 is kept
  - branch and longer-name matches
  - no suggestion for an empty merchant, another kind, or a one-letter key
  - the closest match beating more uses further away
  - most uses, then most recent
- `backend/test/suggestions.integration.test.ts`, 4 passed on the test DB, none skipped. They cover:
  - suggestions on the uncategorized list, and none for an unknown merchant, an empty merchant, or another kind
  - a hidden category never suggested or applied
  - apply: duplicates counted once; unknown, already classified, and missing entries skipped; a chosen category kept; no rule saved
  - bad bodies refused with 400
- `frontend/src/classification.test.tsx`, 3 new tests (21 in the file):
  - one suggestion used alone
  - all applied at once, with a skip reported
  - the list still working when the suggestions fail to load
- `frontend/src/app.test.tsx`: its catch-all mock now also answers `suggestions: []`. Without that field, the ledger page showed a second alert.
- Whole backend suite on the test DB: 398 passed, none skipped.
- Browser (headless Edge, seeded scratch DB) at 1440×900 and 390×844:
  - The two branch entries showed "Suggested: 식비 (from 스타벅스 강남점)" and "Suggested: 생활 (from 이마트)". "동네 철물점" showed none.
  - No horizontal scroll at either size.
  - At 390×844, **Use** classified one entry, and **Apply 1 suggestion** classified the other. The button then went away, and only 동네 철물점 was left.
- `npm run check` passed: frontend 361 passed / 2 skipped; backend 193 passed / 21 DB tests skipped (no test DB in that run). `npm run knip` passed.
