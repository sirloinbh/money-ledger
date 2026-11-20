#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards scripts/ci-migrate.sh (#697).
# Prepares the CI database the same way in every app job (docs/conventions/database.md, #27). DATABASE_URL points at the empty CI database.
# 1) Like Docker init on an empty volume, apply every file once with psql without recording it (checks the files are safe to run again).
# 2) Apply them again with the shared runner (npm run db:migrate), which records them in schema_migrations.
set -euo pipefail
shopt -s nullglob
for migration in database/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done
npm run db:migrate
