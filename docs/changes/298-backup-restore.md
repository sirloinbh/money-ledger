# Back up and restore all data (#298)

Settings gets a "Backup and restore" card. **Download backup** saves one versioned JSON file with every user table; **Restore from a backup file** puts such a file into an empty database.

## The format

`{ app: "money-ledger", format: 1, createdAt, schemaMigration, tables: { <table>: [row, ...] } }`

- Rows are `row_to_json` of each table, ordered by primary key. `numeric` and `bigint` columns travel as text, so no digit is lost in JSON (for example `1.12345678` and `4500000000`).
- `schemaMigration` is the newest migration of the database the file came from. A restore refuses a file from a newer schema (409), a file of another `format` (422) and a file of another app (400).
- The tables come from the schema (`information_schema`), not from a list of names. Every table must be in one of three groups in `backend/src/backup.ts`; a table nobody classified fails the export and the test `every table in the schema is classified`, so a table a later change adds cannot be left out silently.

| Group       | Tables                                                                                                                                                                                           | Behavior on restore                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| entered     | entries, rules, budgets, fixed costs and runs, recurring dismissals, assets, prepaid usages, trades, mock accounts/cash flows/holdings/orders/positions/questions/snapshots, goals, app settings | must all be empty, else 409 and nothing changes    |
| replaceable | default categories, market calendar, prices, rates, news, logs, daily net worth and report saves, daily picks, report change log                                                                 | cleared, then filled from the file                 |
| excluded    | `kakao_connection`, `kakao_login_states` (encrypted tokens, secrets), `schema_migrations` (the runner's history)                                                                                 | never in the file; a file that has them is refused |

## Restore

One transaction: lock the tables, check the schema version, check the entered tables are empty, switch off the row triggers (the report-change log and the prepaid balance check must not run again on valid data), clear the replaceable tables, insert tables parents first (foreign key order) with `json_populate_recordset`, move the identity counters past the restored ids, switch the triggers back on. Any refusal or database error rolls everything back. Unknown tables, unknown columns and rows the database rejects answer 422.

## Changes

| File                                                                | Change                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `backend/src/backup.ts`                                             | Export, restore, the table groups, `GET /api/backup`, `POST /api/backup/restore` (own 100 MB body limit) |
| `backend/src/app.ts`, `backend/src/openapi.ts`, `docs/openapi.json` | Routes registered and documented                                                                         |
| `frontend/src/backup.tsx`, `frontend/src/app.tsx`                   | The Settings card                                                                                        |
| tests                                                               | `backup.integration.test.ts`, `backup.test.tsx`; `openapi.test.ts` mount list                            |

## Decision (pending with the user)

Restore only fills an empty database: the issue's recommendation, built first because it cannot destroy data. "Replace everything" is not built; if the user wants it, it is a second route that clears the entered tables first, behind a confirm step. A database where the app was only opened (it saves today's net worth and reports on open) still counts as empty.

## Verification

- Integration tests on the lane-3 test DB, 0 skipped: classification of every table, export then restore into a fresh database gives an equal second export (seeded rows in most tables, incl. numeric(20,8), > 2^31 won, Korean text, jsonb, arrays), secrets absent from the file, identity counters continue, a non-empty database is refused with no change, and bad files (version, app, table, secret table, column, newer schema, rejected rows) are refused with no change.
- Real browser (Playwright Chromium, API 3193, Vite 5293, a scratch database): at 390x844 the card fits (no horizontal scroll) and a restore into a database with data showed "The database already has data (ledger_entries, net_worth_snapshots, portfolio_assets). A backup is restored only into an empty database"; at 1440x900, after clearing the data, the same file restored 18 rows and the database had the 2 entries and the asset again, with `kakao_connection` still empty.

## Limits

- No scheduled backup and no upload to S3 (the server backup is the AWS side, not this card).
- The file is plain JSON and holds all financial data: keep it private.
