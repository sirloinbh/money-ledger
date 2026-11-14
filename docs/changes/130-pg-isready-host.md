# Check the DB health over TCP (#130)

Issue: [#130](https://github.com/sirloinbh/money-ledger/issues/130), tracked by [project-standards#430](https://github.com/sirloinbh/project-standards/issues/430). Central fix: project-standards#392 (PR #429).

## Purpose

The official postgres image starts a temporary server without a TCP listener on the first start with an empty volume. `pg_isready` checks the unix socket by default, so the health check could pass during that phase and app containers could be refused connections.

## Changes

- `compose.yaml`: the `db` health check is now `pg_isready -h 127.0.0.1 -U $$POSTGRES_USER -d $$POSTGRES_DB`.
- `docs/project-setup.md`: the same snippet is updated.
- `deploy/backup.sh` already uses `-h 127.0.0.1` (it came through sync).
- #414 (migration lock release) does not apply: this repo has no `backend/src/migrations.ts`.

## Verification

- `docker compose config -q` (Docker 29.9.2, with `.env.example` copied to `.env`): passes.
