# #211 Follow the compose deploy contract

- Issue: [#211](https://github.com/sirloinbh/money-ledger/issues/211)
- Branch: `chore/211-compose-deploy-contract`
- Parent: sirloinbh/project-standards#710

## Changes — 2026-11-19

Make compose.yaml follow the shared deploy contract: no initdb migration mount, `$$POSTGRES_*` in the healthcheck, `<db>-backend/frontend:${IMAGE_TAG}` image tags, and `${WEB_BIND}:${WEB_PORT}` for the web port, so `standards-check` passes.

## Why

`standards-check` (project-standards#695) now fails a compose.yaml that breaks the contract that `deploy/remote-deploy.sh` relies on. Without the image tags and the web port variables a failed deploy cannot roll back to the previous image. Mounting migrations into initdb makes a new local DB apply the files without history; the migration runner already does this.

## Local setup change

A new local DB volume no longer gets the schema from Docker. After `docker compose up -d db`, run `npm run db:migrate`. The runner applies every file in name order and records it. `database/README.md` is updated; one-file commands copy the file into the container with `docker compose cp` instead of using the removed mount.

## Verification

- `node scripts/standards-check.mjs --root <this repo>` from project-standards: no `deploy contract` problem.
- `prettier --check` on the changed files.
- The full `npm run check` runs in CI.
