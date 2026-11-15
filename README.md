# Household ledger, assets, and mock investing

A personal service for recording and visualizing money-related activity with a household ledger, an asset portfolio, and mock investing. The user is a single person, and the service runs locally without login.

## Development standard

Node.js **24.21.0**, npm **11.19.0**. Install with `npm ci --ignore-scripts` (after the user confirms), format with `npm run format`, and run the full verification with `npm run check`. The full standard follows the [development environment setup document](docs/project-setup.md) and [AGENTS.md](AGENTS.md).

Changes go through this order: **GitHub issue → branch named with the issue number → implementation, tests, and docs record → `npm run check` → PR → automatic code review (at most 2 rounds) → agent merge after CI passes**.

## Run

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

Open http://localhost:8105 . Change the password in `.env` before you run it. Data is stored in the `money-ledger-data` volume, and `docker compose down -v` deletes the data.

Development run:

```powershell
docker compose up -d db
npm run dev
```

Vite http://localhost:5205, API http://localhost:3105/api/health, host DB port 15405.

## Verification

- `npm run check`: format, lint, types, tests, the skill sync check, and the build.
- DB integration tests need `TEST_DATABASE_URL` for a dedicated test DB with the migrations applied. They are skipped without it.
- GitHub Actions runs the full checks with a PostgreSQL service and builds the Docker images.

## Repository layout

This repository is an umbrella monorepo that holds the whole source. `frontend`, `backend`, and `database` are synced with `git subtree split` to the private deploy repositories `money-ledger-frontend`, `money-ledger-backend`, and `money-ledger-db` (`scripts/push-repositories.ps1`, only on request). The AWS infrastructure is managed in the shared repository `shared-aws-infrastructure`.

## Docs

- [AI instructions](AGENTS.md) · [Claude instructions](CLAUDE.md) · [DB](database/README.md)
- [Change records](docs/changes/README.md) · [Daily logs](docs/daily/README.md) · [Next steps](docs/next-steps/README.md)
