# #34 Menu and empty screens for the ledger, portfolio, and mock investing

- Issue: [#34](https://github.com/sirloinbh/money-ledger/issues/34)
- Branch: `feat/34-area-navigation`

## Purpose

Decide the screen addresses and the menu of the three areas first, so that later feature issues do not conflict in the same files.

## Changes: 2026-11-02

- `frontend/src/app.tsx`: added the `/ledger`, `/portfolio`, and `/mock-trading` addresses and menu. Changed the app display name to `가계부·자산·모의투자` (Korean for "Household ledger, assets, and mock investing") and added mock investing to the dashboard description.
- `frontend/src/ledger.tsx`, `portfolio.tsx`, `mock-trading.tsx`: added an empty-state screen for each area.
- `frontend/src/page.tsx`: moved the shared screen frame out of `app.tsx`.
- `frontend/index.html`: matched the browser tab title to the app display name.
- `README.md`: added mock investing to the service introduction.
- `AGENTS.project.md`, the per-area READMEs, and `skills/money-ledger-*`: changed the app name in the titles to the new name.

## Judgment

- The issue said "a folder to hold feature code", but we made one file per screen instead of folders. The central `docs/directory-rules.md` sets `frontend/src/<feature>.tsx` as the standard.

## Verification

- We added 7 tests to `frontend/src/app.test.tsx`.
  - Clicking the menu moves to the three screens and the current menu is marked (3 tests).
  - Opening the three addresses directly shows the same screens (3 tests).
  - A server error is shown as an alert on an area screen (1 test).
- `npm run check`: passed. Backend: 5 of 6 passed and 1 skipped. Frontend: 65 of 67 passed and 2 skipped. 4 skill tests passed.
- The skipped backend test is the DB integration test. `TEST_DATABASE_URL` on this PC points at another app's DB ([#32](32-dev-env-followups.md)), so we emptied it for the run. The PR CI checks it.
- `npm run standards:check`, `npm run knip`: passed.
- `quick_validate.py` after the skill title change: the 3 skills passed.
- Browser: we opened the Vite dev server with headless Chrome and checked mobile 390×844 and PC 1440×900.
  - Opening the dashboard and the three area addresses directly shows the title, the current menu, and the empty-state guidance correctly.
  - At both sizes, the menu link moves to the mock investing screen. On mobile we checked by opening the menu sheet.
  - There is no horizontal scroll (mobile `scrollWidth` 390, PC 1425 plus a 15 vertical scrollbar).

## Limits

- Without Docker and `.env` we checked without the API. So the browser showed the warning `서버에 연결할 수 없습니다` ("Cannot connect to the server") instead of the normal status text. We checked the normal text with unit tests.
- The Claude in Chrome extension was not connected, so we used headless Chrome.
- We did not change the app name and introduction in `frontend/public/manifest.webmanifest`, `frontend/public/offline.html`, and `AGENTS.md`, because they are central registry values. So the installable app and the offline screen show the old name. We align them with the sync of the central issue [project-standards#399](https://github.com/sirloinbh/project-standards/issues/399).

## Review record

### Round 1: 1 point, addressed in a follow-up commit

- The app display name had diverged from the central registry, but `offline.html` was missing from the record and there was no follow-up work. We registered the central issue #399 and linked it from this record and from `docs/next-steps/README.md`.

### Round 2: first-round fix confirmed, 1 point

- The old name was left in the titles of files that the central sync does not change. We changed the titles of the README and skills that this repository manages to the new name and ran `npm run skills:sync`.
- By the standard, we do not run a third review.
