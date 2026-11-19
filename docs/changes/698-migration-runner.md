# Use the managed migration runner (project-standards#698)

## Change

- `backend/src/migrations.ts` and its unit test are removed. The runner is now the managed `backend/src/standard/migrations.ts` and `migrate.ts` (project-standards#677), which the sync PR brings.
- `backend/src/migrate.ts` is a one-line entry that imports `./standard/migrate.js`, so `node dist/migrate.js` (deploy) and `npm run db:migrate` keep working.
- The integration tests import the managed runner and pass their own advisory lock key; messages follow the managed runner (`<file> failed to apply`, `was changed`).

## Reason

Six apps kept drifted copies of the runner (lock keys, missing `--status`, unknown flags applying, a BOM sent to PostgreSQL). One managed copy removes the drift. The advisory lock key is now 581000 plus the registry slot; apps use separate databases, so the change is harmless.

## Verification

- The managed runner accepts every file in `database/migrations` (checked with `readMigrations`). The runner's own unit tests live in project-standards.
