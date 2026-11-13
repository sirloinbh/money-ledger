# Initial development environment setup (before issues)

- Date: 2026-10-19 (Asia/Seoul)
- Baseline: workout-memo's [development environment setup document](../project-setup.md) (workout-memo PR #57)

## Purpose

Prepare the development environment, the minimal app, the verification, and the repositories so that the money-ledger project can be developed issue by issue. Detailed features proceed after the user registers issue cards.

## Contents

- Stack: React 19 + Vite + TypeScript, Express 5 + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions. Node 24.21.0 / npm 11.19.0.
- Dependencies: only the same packages and versions as workout-memo's lockfile were used (only the workspace names changed). With the user's approval we installed with `npm ci --ignore-scripts` and added no new packages. `npm audit`: 0 vulnerabilities.
- Minimal app: `GET /api/health` (DB check, service date), Korean-language 404 and 500 error handling, a sidebar, page header, status display, empty state screen, and design tokens based on CSS variables.
- DB: `database/migrations/001_initial.sql` (a re-runnable `app_settings`). For an existing DB we describe only the `psql -f` way to apply.
- Tests: unit (`health.test.ts`), DB integration (`db.integration.test.ts`, skipped without `TEST_DATABASE_URL`), UI (`app-ui.test.ts`, a vm harness), and the skill sync check.
- AI instructions: `AGENTS.md`, `CLAUDE.md`, and 3 skills (source in `skills/`, copy in `.claude/skills/`).
- Repositories: the umbrella `sirloinbh/money-ledger` + the deploy sub-repositories `money-ledger-frontend`, `money-ledger-backend`, and `money-ledger-db` (private, subtree). AWS uses the shared `shared-aws-infrastructure`.

## Verification

- We applied the migrations in UTF-8 to the dedicated test DB `money_ledger_test` (workout-memo's test container) and ran `npm run check`: **exit 0**.
  - App and DB tests **8 pass / 0 fail / 0 skip** (the DB integration test really ran)
  - Skill check **4 pass / 0 fail / 0 skip**
  - Format, lint, and types passed, and the frontend and backend builds passed
- The real browser check was done in study-log, which was made from the same template (no horizontal scroll at mobile 390px, status and menu switching normal, PC 1440px normal). This project differs only in the title and ports, and we checked it with UI tests.
- The initial commit was pushed directly to `main` to create the repositories. After that, every change goes issue → branch → PR.
- The Docker image build is checked by the `docker-build` job in GitHub Actions. We did not run a local `docker compose up`.
