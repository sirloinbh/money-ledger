# #180: keep applied migration files matching their recorded checksums

Issue: https://github.com/sirloinbh/money-ledger/issues/180 (parent #206)

## Purpose

The runner refuses to start when an applied file differs from the checksum in `schema_migrations`, which would stop
every deploy at the migration step. The review found that `002`, `004` and `005` were edited (comments only) after
being applied, and asked to restore the applied text.

## Decision (user, 2026-11-22, option A): keep the current text

The restore was not needed, and would have caused the failure it was meant to prevent:

- The comment edits (002, 004, 005, and also 006 and 013) were made in #123 (`cd9f4d3`, 2026-11-13).
- Checksums are recorded only since the runner and `schema_migrations` arrived in #71 (`4a14800`, 2026-11-16). A DB set
  up before then recorded every file on its first `db:migrate`, with the text of that day.
- None of the five files changed after `4a14800` (`git diff --stat 4a14800 origin/main -- …` is empty).

So every DB with history recorded the current text. The pre-#123 text has other checksums (002 `e1548da7…`, 004
`fe8b702b…`, 005 `bf9c0ed0…`), which no DB holds; restoring it would make the runner refuse on every DB with history.

The other two runner tasks are no longer app code: the runner is the managed `backend/src/standard/migrations.ts`.

- It already runs the SQL with the BOM stripped (`readMigrations` stores `sql: stripBom(raw)`), the same text the
  checksum uses.
- Its `MigrationDb = Pick<Client, 'query'>` still accepts a `Pool` (checked: `const db: MigrationDb = new Pool()`
  compiles). Managed files are not edited here: filed as sirloinbh/project-standards#997.

## Changes

| File                                       | Change                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/test/migration-checksums.test.ts` | New. Pins the runner's checksum of every file on main (001–024). Fails when a pinned file changes or disappears, or when an unpinned file sorts at or below the last pinned one. A newer file may stay unpinned until its line is added. |
| `database/README.md`                       | Rules: the pin test exists, and a new migration adds its line there.                                                                                                                                                                     |

## Verification

- `backend/test/migration-checksums.test.ts`: 2 pass. With `-- edited` appended to `002_ledger_categories.sql` the
  first test fails ("changed after it was applied"); after `git checkout` it passes again.
- The pinned values for 002, 004 and 005 equal the rows in `schema_migrations` of the test DB
  `money-ledger-test-agent3`, recorded by the runner earlier today.
- `npm run db:migrate` on that DB (history through 022): applied the new `023` and `024`, then a second run printed
  "No pending migrations." No "Applied migration file was changed".

- `TEST_DATABASE_URL=<agent3 test DB> npm run check` (shared lock): exit 0. Backend 432 pass / 0 skipped, frontend
  466 pass / 3 skipped, skills 4 pass, build ok. (The first run failed lint on the import order of the new test; fixed
  with `eslint --fix`.) `npm run knip`: exit 0.

## User TODO

- If a server DB exists and has run `db:migrate`, confirm its `schema_migrations` checksums for 002, 004 and 005 match
  the pinned values (`SELECT name, checksum FROM schema_migrations ORDER BY name;`).
