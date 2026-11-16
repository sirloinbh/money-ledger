# #71 Apply migrations automatically on deploy

The deploy script `deploy/remote-deploy.sh` is a central managed file. It runs `node dist/migrate.js` before starting a new version, but this app had no `migrate.ts`. Migrations reached an existing DB only when someone ran `psql` by hand.

## What changed

- `backend/src/migrations.ts`: the shared migration runner, ported from the central scaffold (`project-standards` `scaffold/app/backend/src/migrations.ts`), with the English messages study-log uses.
  - It reads `database/migrations/NNN_name.sql` in name order and refuses bad names and duplicate numbers.
  - It records each applied file in `schema_migrations` with a checksum that ignores line endings and a BOM.
  - It refuses to run when an applied file was changed or removed, or when a new file is numbered before an applied one.
  - Each file and its history row commit together, so a failure rolls back that file only and names it.
  - An advisory lock (key `581_005`) makes a deploy and a host run take turns.
- `backend/src/migrate.ts`: the command.
  - It prints the files it applied, or "No migrations to apply."
  - It exits 1 on any error, including a missing `DATABASE_URL` or a refused connection, so a deploy stops before it starts the new version (`set -euo pipefail`).
  - The path `../../database/migrations/` resolves to the repository folder from `src` and `dist` alike, and to the `/database/migrations` mount in the deploy container (`WORKDIR /app`).
- `backend/package.json`: `db:migrate`. `package.json` (root): `db:migrate` forwards to the backend, which the central CI runs after its `psql` pass. It now records history instead of warning that no runner exists. Only fields of the `package.json` files are centrally managed; `standards:check` passed.
- `database/README.md`: the runner is now the way to apply migrations (deploy, host, CI, empty volume), with its refusals and the rules, including no `BEGIN`/`COMMIT` in files. `docs/project-setup.md` was aligned with it.

## Checked before porting

- Every money-ledger migration can run again, which the runner relies on for a database without history. The `BEGIN` lines in 007, 010, 013, 015, 016, and 019 are inside `DO $$ … END $$` blocks, not transactions, so a file's own `COMMIT` cannot end the runner's transaction early.
- The file names all match `NNN_name.sql`. The number gaps (008, 011, 014) are allowed.

## Verification (2026-11-16)

- `backend/test/migrations.test.ts` (from study-log), 5 passed. They cover:
  - the checksum ignoring line endings and a BOM
  - pending files in order
  - changed and missing files refused
  - a new file numbered before an applied one refused
  - folder reading: sort order, bad names, duplicate numbers
- `backend/test/migrations.integration.test.ts`, 6 passed on the test DB, none skipped. It uses separate databases because the migrations' guards look constraint names up across the whole database.
  - On an empty database, all 18 files apply in order and are recorded; a second run applies nothing.
  - **Done-when:** a database with only `001` and `002` applied by hand and no history gets the rest. It keeps its data (a category added beforehand), and running again applies nothing, without errors.
  - A changed file stops the run before anything is applied.
  - A failing file rolls back alone, leaves the file before it applied, and can be fixed and rerun.
- The built command, on a scratch database:
  - `node dist/migrate.js` applied all 18 files and exited 0.
  - `npm run db:migrate` then printed "No migrations to apply." and exited 0.
  - With an unreachable database it printed `connect ECONNREFUSED 127.0.0.1:1` and exited 1.
  - Without `DATABASE_URL` it printed "DATABASE_URL is required. Check .env." and exited 1.
- The root `npm run db:migrate`, run the way CI runs it against the test DB, recorded all files.
- Whole backend suite on the test DB: 388 passed, none skipped.
- `npm run check` passed: frontend 358 passed / 2 skipped; backend 188 passed / 20 DB tests skipped (no test DB in that run). `npm run knip` and `npm run standards:check` passed.

### Review (PR #153)

- No blocking findings.
- In a deploy the runner runs inside the api image with the migrations mounted at `/database/migrations`, and `set -euo pipefail` stops on its exit code before `docker compose up -d`.
- The runner takes a session-level advisory lock, so a host run and a deploy take turns.
- Other integration tests drop and recreate tables in the shared test DB but never touch `schema_migrations`, so CI's recorded history does not affect them.
- Not changed (note): the integration test needs a test DB user that can create databases. Both CI's user and the local container's user are the Postgres superuser. This is noted in the test.
