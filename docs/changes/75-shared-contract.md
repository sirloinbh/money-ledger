# #75 Shared input contract (shared/contract.ts)

The category kind and name rules now live in one place, `shared/contract.ts`. The API and the category screen validate with the same schema and the same messages.

## Decisions (2026-11-17, recorded on #75)

- **Built in this repo.** The central registry flag `features.contract` stays off. Only scaffolding a new app reads it (project-standards `scripts/scaffold.mjs`); the standards sync never does, so turning it on would change nothing here. The scripts are the central scaffold's `scripts/contract.mjs`, the same as workout-memo.
- **zod added to the frontend (user approved).** Version 4.6.7 is the backend's, already in the lockfile, so nothing new is downloaded. The agent's hook blocks installs, so the user ran the two `npm install` commands. zod is also declared at the root as a dev dependency, because `shared/contract.ts` imports it and strict knip refuses an unlisted dependency.

## What changed

- `shared/contract.ts`: `categoryKind` and `categoryName`, moved from `backend/src/categories.ts`. The name is trimmed, NFC, 1 to 30 characters, and not the reserved "Uncategorized" or "미분류" (#110). It exports only what both sides use, because knip checks each copy.
- `scripts/contract.mjs` and `scripts/test/contract.test.mjs`: from the central scaffold and workout-memo.
  - `npm run contract:sync` copies the source to `backend/src/contract.ts` and `frontend/src/contract.ts`.
  - `npm run contract:check` fails on any difference. It ignores line endings, and it now runs in `npm run check`.
- `backend/src/categories.ts`: uses the shared schemas; the rest of the request bodies stay local.
- `frontend/src/categories.tsx`:
  - The add and rename forms check the name with `categoryName` before sending. A refused name shows the server's message, and the typed text stays.
  - The field's `maxLength` comes from the schema (`categoryName.maxLength`).
  - `CategoryKind` is inferred from `categoryKind`.
- `backend/test/contract.test.ts`: tests the source file itself. That import also makes knip count `shared/contract.ts` as used; `knip.json` is centrally managed, so it can't list the file instead.
- `frontend/package.json`, `package.json`, `package-lock.json`: zod 4.6.7. `frontend/package-lock.json` was aligned with `npm run lockfiles:sync`, which `standards:check` asked for.

## Impact

- The page bundle grew from 619.23 kB (gzip 185.32 kB) to 690.23 kB (gzip 206.59 kB), measured with `vite build` before and after.
- `npm install` reports 11 moderate advisories. They all come from `minimatch` through the eslint dev tools, are already tracked in #113, and are unrelated to zod.

## Verification (2026-11-17)

- `backend/test/contract.test.ts`, 3 passed: trimming, NFC, the 1–30 limit, and `maxLength` 30; the reserved names in any case or spacing; the kind values and message.
- `frontend/src/categories.test.tsx`, 2 new tests (14 in the file):
  - adding " Un categorized " is refused with the server's message before sending, the text stays, and the field's limit is 30
  - renaming to "미분류" is refused the same way and stays in the form
- `npm run contract:check`: the copies match, and the script's 2 tests pass.
- Whole backend suite on the test DB: 398 passed, none skipped (before `contract.test.ts` was added; it has no DB part).
- `npm run check` passed: frontend 365 passed / 2 skipped; backend 196 passed / 21 DB tests skipped (with `contract.test.ts`). `npm run knip` and `npm run standards:check` passed.
