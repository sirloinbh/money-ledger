# #44 Ledger entries as CSV

Download entries as a CSV file, and import entries from a bank or card statement CSV after a preview.

## Decisions (user, 2026-11-16, recorded on #44)

- Duplicates: a row that matches an existing entry on date, kind, amount, and merchant is flagged in the preview. The user chooses to skip (the default) or keep those rows.
- Format: export is UTF-8 with a BOM, so Excel shows Korean correctly. Import reads UTF-8 with or without a BOM. CP949 bank and card files come later with #57-#59.

## What changed

- `GET /api/ledger/entries/csv` (backend/src/entry-csv.ts): the entries the list filters match (same query as the list, without paging), oldest first. Columns are `date,kind,amount,category,merchant,memo`, with CRLF line ends and a BOM, served as `ledger-entries-<today>.csv`. Fields with a comma, quote, or line break are quoted. A field that starts with `=`, `+`, `-`, `@`, tab, or CR gets a leading `'`, so Excel does not run it as a formula.
- `POST /api/ledger/entries/csv/preview` takes `{ rows }` and checks every row. It answers with the row count, the valid count, every problem with its row number, and the rows that look like duplicates.
- `POST /api/ledger/entries/csv/import` takes `{ rows, skipDuplicates }` and checks again in one transaction. If any row is wrong it answers 422 with the problems and saves nothing. Otherwise it saves all rows, skipping duplicates unless asked to keep them, with one `INSERT`.
  - An empty category is filled by the keyword rules (#60), like a new entry.
  - A category is matched by name within the row's kind, and must not be hidden.
  - Imports take an advisory lock, so two imports of the same file cannot both miss each other's rows.
- The router has its own 2 MB JSON limit (2,000 rows with notes do not fit the app-wide 256 kB), so it is mounted before the app-wide parser. At most 2,000 rows per import.
- Screen: a "CSV" card under the entry filters (frontend/src/entry-csv.tsx, parsing in entry-csv-parse.ts).
  - "Download CSV" follows the current filters.
  - Choosing a file reads it in the browser. A file that is not UTF-8, has no rows, or has more than 2,000 rows is refused before sending. Columns are guessed from English or the usual Korean header names (이용일자, 가맹점명, 이용금액, …) and can be changed.
  - Without a kind column, one kind applies to every row (expense by default).
  - Kind words 수입/지출/입금/출금 are understood. Amounts drop thousands separators, a leading ₩, and a trailing 원. Dates like 2026.11.05 or 2026/11/05 become 2026-11-05. Anything else goes to the server as is, so it names the problem.
  - "Check the rows" shows the preview and moves focus to its heading. Problems are listed by row number (counting the header as row 1, as a spreadsheet does). Likely duplicates come with a "Skip these rows" checkbox.
  - Changing a column choice drops the preview. After an import the list and the other cards reload, and focus goes back to the file field.
- backend/src/entries.ts exports `listQuery` and `listFilter` so the export uses the list's filters. backend/test/helpers.ts exports `listen` for tests that read a raw (non-JSON) response.

## Choices made here

- The browser parses the CSV and sends JSON rows, so the server never handles file uploads or encodings, and the mapping stays on screen.
- Duplicate detection compares with entries already saved, not rows inside the same file: two identical card payments on one day are normal.

## Verification (2026-11-16)

- DB tests (`backend/test/entry-csv.integration.test.ts`, test DB on agent2): 6 of 6 subtests passed, none skipped.
  - Export: BOM, header, order, quoting, formula guard, filters.
  - Preview: every bad row with its line, and duplicates.
  - Import: one bad row saves nothing.
  - Import: categories by name, rules, and skip or keep duplicates.
  - An exported file imports back as the same entries.
  - 2,000 rows fit and 2,001 are refused.
- Full backend suite on the test DB: 356 of 356 passed, 0 skipped.
- Screen tests: `entry-csv-parse.test.ts` (5) and `entry-csv.test.tsx` (8) passed.
- `npm run check` passed: frontend 335 passed and 2 skipped; backend 173 passed and 18 DB tests skipped without a test DB. `npm run knip` passed.
- Browser check (headless Edge, API and Vite against the test DB):
  - The download served `text/csv; charset=utf-8`, `ledger-entries-2026-11-16.csv`, bytes `ef bb bf`, and the header row.
  - At 390×844, a card statement (`이용일자,가맹점명,이용금액,비고`) was mapped by its Korean headers. "Check the rows" said "All 3 rows can be imported" with focus on that heading, and "Import 3 entries" added them to the list as Uncategorized expenses.
  - Choosing the same file again flagged rows 2, 3, and 4 as likely duplicates; with "Skip these rows" checked the button says "Nothing to import".
  - At 1440×900 the column choices sit in three columns.
  - Page width was 390 and 1425 (no horizontal scroll).

### First review (PR #145)

- No blocking issues. Fixed in this PR:
  - A preview that answers after the file, a column, or the kind changed is dropped. The import sends the very rows that were checked, kept with the preview.
  - Blank rows and rows of only commas (Excel often adds them) are left out instead of failing the import. Row numbers still match the spreadsheet: blank lines are counted, and a quoted field with a line break stays one row.
  - Import strips the leading `'` that export adds before `=`, `+`, `-`, `@`, tab, or CR, so an exported file imports back as the same text (DB test with `+Cafe` and `@home`).
  - The preview reads categories without a lock; only the import share-locks them. A comment says the advisory lock does not hold back entries saved by hand: duplicates are a hint, not a constraint.
- Tests: a parse test for blank rows and row numbers, a quote inside an unquoted field, and a lone CR; screen tests for the dropped late answer and for importing the checked rows; the round trip now includes formula-guarded text.
- Not changed: the remaining test-gap ideas (413 over 2 MB, two imports at once, NFD names) are covered by the shared error handler and the existing lock and normalization code.
- After the fixes: `npm run check` passed (frontend 338 passed / 2 skipped; backend 173 passed / 18 DB tests skipped), `npm run knip` passed, and the CSV DB tests passed 6/6 subtests on the test DB. The layout did not change, so the browser check above was not repeated.

### Second review (PR #145)

- Fixed: since blank lines are now kept for row numbers, a file starting with a blank line got an empty header. The header is now the first row with something in it; rows before it are skipped (parse test).
- Left as is: text that really starts with `'` and then `=`, `+`, `-`, or `@` (for example a note `'-5 off`) loses that `'` on import, because it looks like the export's guard. Rare in a ledger. A Check clicked before a column change still waits for its (dropped) answer before it can be clicked again.
- After the fix: `npm run check` passed (frontend 339 passed / 2 skipped; backend 173 passed / 18 DB tests skipped) and `npm run knip` passed.
