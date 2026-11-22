# #199 Let bulk classification skip mismatched rows and tighten suggestions

- Issue: [#199](https://github.com/sirloinbh/money-ledger/issues/199)
- Branch: `fix/199-classify-mixed-kinds`
- Parent: #88 Ledger input automation and category management

## Purpose

The code review of 2026-11-18 found two problems:

- `POST /api/ledger/entries/classify` refused the whole request when any selected entry was of the other kind, although its update already skips such rows. One income entry in a selection blocked classifying every expense entry.
- The suggestion key stripped every digit and accepted a two-letter prefix, so "GS25" (`gs`) matched "gs칼텍스" and "카페24" (`카페`) matched every "카페…".

## Changes

- `backend/src/entries.ts`: the kind pre-check is gone. Entries of the other kind are skipped like those classified or deleted meanwhile, and counted in `skipped`. The hidden or unknown category checks stay.
- `frontend/src/classification.tsx`: a mixed selection is sent; only a category that fits none of the selected entries is refused before sending ("None of the selected entries is the kind of this category"). The status says "N skipped (a different kind, or already classified or changed)".
- `backend/src/suggestions.ts`: `merchantKey` keeps digits inside a word ("GS25" → `gs25`, "카페24" → `카페24`) and drops words of only digits or punctuation ("쿠팡 1234567" → `쿠팡`). A prefix match needs a key of 3 characters or more; the same key still matches from 2. This keeps the #154 decision (normalized name or prefix, no `pg_trgm`, no saved rule).

## Verification

Tests (the new and changed ones fail on the `origin/main` sources and pass now: backend 3 failed then 0, frontend 4 failed then 0):

- `backend/test/classification.integration.test.ts`: a selection with an income entry, an already categorized entry and an unknown ID classifies the 3 uncategorized expense entries, skips 3, and leaves the income entry uncategorized.
- `backend/test/suggestions.test.ts`: the key keeps `gs25` and `카페24` and drops number words; "GS25" does not suggest the "gs칼텍스" category, "카페24" and "카페" do not suggest "카페베네", "쿠팡이츠" does not match "쿠팡", "쿠팡 1234567" does, and "이마트에브리데이" still matches "이마트".
- `frontend/src/classification.test.tsx`: a mixed selection classifies the matching entry and reports the skip; only-other-kind selections are refused before sending; the status wording.
- Targeted runs: backend suggestions and classification tests 31 pass, 0 skipped (DB); frontend classification 24 pass.
- `npm run check` (shared lock, `TEST_DATABASE_URL` on the agent2 test DB): pass. Backend 426 pass, 0 skipped; frontend 467 passed, 3 skipped (managed `skipIf` tests); build pass.
- `npm run knip`: pass.

Browser (Vite 5292 + API 3192 on a local `money_dev` DB, Playwright):

- 390×844: three uncategorized entries (two expense, one income) selected with an expense category: "2 entries classified as 식비. 1 skipped (a different kind, or already classified or changed). Saved 1 merchant rule"; the list shows 1 left. No horizontal overflow.
- 1440×900: only the income entry selected with an expense category: alert "None of the selected entries is the kind of this category" and the category field is marked invalid; nothing sent. No overflow.

## Limits

- Digits glued to a name that are really a terminal number ("스타벅스123") now stay in the key, so such a merchant matches only itself or a 3+ character prefix. Card statements usually separate them with a space, which is dropped.
- "쿠팡" no longer prefix-matches "쿠팡이츠" (two letters). That is the intended trade-off of the issue.

## Review

- Round 1: approve, no blocking comments (posted on PR #245). Checked that the update's kind filter limits writes, that remembered rules come from updated rows only, that the 400 statuses still apply, and that `merchantKey` is used only by `suggester`.
