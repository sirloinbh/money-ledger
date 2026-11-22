# #200 Make CSV import refuse malformed files and never drop rows

- Issue: [#200](https://github.com/sirloinbh/money-ledger/issues/200)
- Branch: `fix/200-csv-import-safety`
- Parent: #88 Ledger input automation and category management

## Purpose

The code review of 2026-11-18 found that the CSV import could drop or merge rows without a word:

- The server keys likely duplicates by the client's `line`, which was not checked for uniqueness: a non-duplicate row that shares a line number with a duplicate was skipped too. A `line` above 2^31 answered 500 (the duplicate check casts it to `int[]`).
- The browser parser never noticed an unclosed quote, so every later row was merged into one field.
- The whole file was read before any size check, a read error was not caught, "Skip these rows" and the fixed kind carried over to the next file, and an import that finished after another file was chosen cleared that new file.
- `?uncategorized=true` exported every entry, and `kindWords[...]` matched inherited keys such as `constructor`.

## Changes

- `backend/src/entry-csv.ts`: `line` must be 1 to 2,147,483,647, and every row must have its own line number; otherwise preview and import answer 400 ("Each row must have its own line number"). The export honors `uncategorized=true` (same rows as the uncategorized list's filter).
- `frontend/src/entry-csv-parse.ts`: `parseCsv` throws `CsvError("Line N has an unclosed quote")`, N being the file line the quote opens on (CRLF, LF and lone CR all count). Kind words use `Object.hasOwn`. New `maxImportBytes` (2 MB, the API's JSON limit for this route).
- `frontend/src/entry-csv.tsx`: a file over 2 MB is refused before it is read; a read error says "Could not read the file. Choose it again"; an unclosed quote says the parser's message plus "Fix the file and choose it again". Each new file starts with "Skip these rows" on and the fixed kind Expense. An import that finishes after another file was chosen still reports its result and reloads the list, but keeps the new file's form.
- `docs/openapi.json`: regenerated (`npm run openapi`); only the `line` maximum changed.

## Verification

Tests added (all fail on the `origin/main` sources and pass now: frontend 5 failed then 0, backend 2 subtests failed then 0):

- `backend/test/entry-csv.integration.test.ts`: a repeated line number is refused with 400 on preview and import and nothing is saved; `line` 2^31 is refused with 400; `uncategorized=true` exports only the uncategorized entry.
- `frontend/src/entry-csv-parse.test.ts`: an unclosed quote names its line (LF and CRLF, after a closed multi-line quote); `constructor` is not a kind word.
- `frontend/src/entry-csv.test.tsx`: an unclosed quote, a file over 2 MB (never read) and an unreadable file are refused before sending; a second file after an import starts from the default choices; an import that finishes after another file was chosen keeps the new file.

Commands:

- `npm run check` with `TEST_DATABASE_URL` on the agent2 test DB: pass. Backend `node --test`: 413 pass, 0 fail, 0 skipped. Frontend Vitest: 70 files, 461 passed, 3 skipped (managed `skipIf` theme and app-count tests). Build passes.
- `npm run knip`: pass.

Browser (Vite 5292 + API 3192 on a local `money_dev` DB, Playwright):

- 390×844: a file with an unclosed quote on line 3 shows "Line 3 has an unclosed quote. Fix the file and choose it again" in the CSV card; no columns form; no horizontal overflow.
- 1440×900: a file with kind `constructor` is checked and listed as "Row 2: Kind "constructor" is not income or expense"; no overflow.
- `curl /api/ledger/entries/csv?uncategorized=true` returned only the uncategorized entry.

## Limits

- The "Line N" of an unclosed quote is the line in a text editor; other messages use spreadsheet row numbers. A broken quote makes the spreadsheet row unknowable, so the text line is the useful one.
- `uncategorized=true` together with `category=<id>` exports the uncategorized entries; the export does not combine the two.
