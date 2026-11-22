# Household ledger, assets, and mock investing: PostgreSQL

PostgreSQL 17. The only source of the migrations is `migrations/NNN_<description>.sql`.

## Applying migrations

The shared migration runner (`backend/src/standard/migrations.ts`, #71) applies the files in name order. Each file is recorded in the `schema_migrations` table with a checksum, so a file is applied once.

- **Deploy**: `deploy/remote-deploy.sh` runs `node dist/migrate.js` after starting the DB and before starting the new version. If a migration fails, the deploy stops and the old version keeps running.
- **Host**: `npm run db:migrate` applies the pending files to the `DATABASE_URL` in `.env`. It prints the files it applied, or "No migrations to apply."
- **CI**: applies every file once with `psql` (checking they can run again), then runs `npm run db:migrate`.
- **Empty Docker volume**: Docker applies nothing. Start the DB, then run `npm run db:migrate`, which applies every file in name order and records it.

A database set up before the runner existed has no history. Its first `db:migrate` runs every file once more, keeps the data, and records them. From then on, only new files run.

The runner refuses to start when:

- an applied file was changed or removed
- a new file is numbered before one already applied
- a file name does not look like `NNN_name.sql`, or two files share a number

Each file runs in its own transaction with its history row. A failing file rolls back alone and names itself; files before it stay applied.

To apply one file by hand, for example while investigating, copy it into the container and run it there. The runner will run it again later, which is safe.

```powershell
docker compose cp database/migrations/NNN_<description>.sql db:/tmp/NNN_<description>.sql
docker compose exec -T db psql -U money -d money -v ON_ERROR_STOP=1 -f /tmp/NNN_<description>.sql
```

Do not pass it through a PowerShell pipe such as `Get-Content … | docker compose exec … psql`. Windows PowerShell 5.1 sends ASCII to external programs, so Korean text is corrupted into `?`.

## Rules

- Write every migration so that it is safe to run again.
- Never edit or delete a file once it has been applied anywhere; add a new file instead. The runner checks this with the checksum.
- `backend/test/migration-checksums.test.ts` pins the checksum of every shipped file, so an edit fails `npm test` before it can stop a deploy. When a new migration merges, add its line there (#180).
- Parallel branches reserve their number when they start.
- Preserve the meaning of existing data, and leave values you could not confirm as NULL.
- Do not put `BEGIN`/`COMMIT` in a file: the runner already wraps each file in a transaction. `DO $$ BEGIN … END $$` blocks are fine.
- For Korean literals in SQL, use the `U&'\XXXX'` escape where possible.
