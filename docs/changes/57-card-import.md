# Import a Woori Card usage file (#57)

Upload the card's usage history file (.xls from the card website), see what importing it would do, and save it as expenses. The rules come from the user's decisions on #56 (2026-11-18) and #57.

## Design

- **Where the file is read.** The browser sends the file's bytes as they are; the server reads the first sheet (`card-import-xls.ts`, the only file that uses the `xlsx` package) and hands plain rows to `card-import-parse.ts`, which has no file or database access. The file is never stored (limit 5 MB, 2,000 payments).
- **Domestic and foreign files.** Domestic: one row per payment. Foreign: two rows per payment (date and amounts, then time and approval number). The year comes from the period line `(2026.01.01 ~ 2026.01.31)`.
- **Rules.** A cancellation is netted (amount minus cancelled); a fully cancelled payment is removed from expenses (or not added); an all-zero foreign row is a card-check authorization and is left out; an installment is one payment at the full amount with "할부 N개월" in the memo (#57 decision); a pending row is a normal payment that a newer file updates.
- **No double save.** An entry keeps only `source`, the last 4 card digits and the approval number (migration `054_entry_card_source.sql`, unique together). The same or a newer file finds the entry and updates it. The full card number is never kept. One import runs at a time (advisory lock).
- **Likely duplicates.** A payment with the same day and amount as an entry typed by hand is flagged; it is left out unless the person unticks the box (#56 decision).
- **Nothing is saved when any row cannot be read.** The preview lists those rows; import answers 422.

## Changes

| File                                                        | Change                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `database/migrations/054_entry_card_source.sql`             | `source`, `source_card`, `source_ref` and a unique index                   |
| `backend/src/ledger/card-import-parse.ts`                   | Pure sheet reader (domestic and foreign)                                   |
| `backend/src/ledger/card-import-xls.ts`                     | `.xls` / `.xlsx` bytes to rows                                             |
| `backend/src/ledger/card-import.ts`                         | `POST /api/ledger/entries/card-import/preview` and `/import`               |
| `backend/src/app.ts`, `openapi.ts`                          | Mounted before the JSON parser; documented                                 |
| `frontend/src/card-import.tsx`, `entries.tsx`, `lib/api.ts` | The upload card on the Ledger page                                         |
| tests                                                       | Parser, reader (real BIFF8 file made in memory), DB integration, component |

## Dependency: `xlsx` 0.20.3 from the SheetJS site (user decision, 2026-11-26)

`backend/package.json` points at `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, installed with `--ignore-scripts`; the lockfile pins its integrity hash, so `npm ci` checks the tarball. The npm registry stops at 0.18.5, which `npm audit` flags as high with no fix (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9); both are fixed in the site's 0.20.x build, and `npm audit` now reports 0 vulnerabilities. Cost: Dependabot cannot update a URL dependency, so a new SheetJS version is a manual change. The build also needs the SheetJS site to be reachable at install time.

## Limits

Only Woori Card files. The reader was checked with generated files, not a real download (no sample file is kept in the repo, as it holds personal data). Other card companies, Coupang and Kakao Pay are #58 and #59.

## Browser check (2026-11-26)

Real browser on the lane ports (API 3191, Vite 5291) with a fake `.xls` (BIFF8) made in memory, 3 payments (one installment, one fully cancelled). At 390x844 and 1440x900 there is no horizontal scroll. "Check the file" listed 2 to add and 1 cancelled, not added. "Import" added 2 entries (the installment has "할부 3개월" in its memo). The same file sent again changed nothing (2 unchanged, 1 left out).
