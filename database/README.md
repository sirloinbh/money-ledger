# Household ledger, assets, and mock investing: PostgreSQL

PostgreSQL 17. The only source of the migrations is `migrations/NNN_<description>.sql`. On an empty Docker volume, all files are applied automatically in name order on the first run, and CI also applies all files in order.

For an existing DB, apply a new migration directly from the file mounted in the container.

```powershell
docker compose exec -T db psql -U money -d money -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/NNN_<description>.sql
```

Do not pass it through a PowerShell pipe such as `Get-Content … | docker compose exec … psql`. Windows PowerShell 5.1 sends ASCII to external programs, so Korean text is corrupted into `?`.

Rules: write every migration so that it is safe to run again. Parallel branches reserve their number when they start. Preserve the meaning of existing data, and leave values you could not confirm as NULL. For Korean literals in SQL, use the `U&'\XXXX'` escape where possible.
