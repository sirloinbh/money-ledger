# #32 Record the problems left from the development environment setup

- Issue: [#32](https://github.com/sirloinbh/money-ledger/issues/32)
- Branch: `docs/32-dev-env-followups`

## Purpose

On 2026-11-02 we set up the development environment of the work PC against the central standards (`sirloinbh/project-standards`). By the user's decision, the remaining problems are put off, and this document records their causes and fixes. This change only edits docs and does not fix the problems.

## Changes: 2026-11-02

- `docs/changes/32-dev-env-followups.md`: recorded the setup result, the 5 remaining problems, and the recovery order.
- `docs/next-steps/README.md`: added the "Development environment follow-ups" table.
- `docs/daily/2026-11-02.md`, `docs/daily/README.md`: added the daily record and the list.

## Setup result: 2026-11-02

- We moved the working folder to the latest `origin/main` (`14249b6`). The local copy was 53 commits behind.
- We installed 474 packages with `npm ci --ignore-scripts`. The lockfiles did not change. The package token (`NODE_AUTH_TOKEN`) was used only for the install command and was not stored.
- We confirmed Node 24.21.0, npm 11.19.0, Claude Code 2.1.316, and the GitHub account `sirloinbh`.

| Item checked                 | Result                                                                    |
| ---------------------------- | ------------------------------------------------------------------------- |
| `npm run check`              | Passed. The DB integration tests ran on another app's test DB (problem 2) |
| `npm run standards:check`    | Passed (central `b85f96f`)                                                |
| `npm run knip`               | Passed                                                                    |
| Vite screen (5205)           | 200 response                                                              |
| API `/api/health`            | 200 response on temporary port 13105 with another app's test DB           |
| API through the Vite proxy   | Could not confirm (problem 4)                                             |
| Docker Compose run           | Could not confirm (problem 1)                                             |
| `money` and `money_test` DBs | Do not exist (problem 1)                                                  |

## Remaining problems

### 1. Docker Desktop does not start

- Cause: virtualization is turned off in the firmware (BIOS). The error code is `Wsl/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED`.
- Impact: we cannot start the DB and the whole app with `docker compose`, and the host DB port 15405 does not open either.
- Fix: turn on virtualization in the BIOS (SVM Mode on AMD). Run `wsl --install --no-distribution` in an administrator PowerShell and reboot.

### 2. `TEST_DATABASE_URL` points at another app's test DB

- Cause: the user environment variable on this PC points at `study_test`.
- Impact: the DB integration tests of `npm run check` run on that DB. That DB has an `app_settings` table, so the tests pass, but we do not accept that as DB verification of this project. These tests and `/api/health` only read, so no data was written.
- Fix: another app may use it, so we do not change the user environment variable. Override it with `money_test` only in this project's terminal. The commands are in "Recovery order" below.

### 3. There is no `.env`

- Cause: the security setting of the agent session blocks access to `.env`, so we did not create it.
- Impact: `npm run dev` and `docker compose` do not get the DB connection information. Without `DATABASE_URL`, the API tries to connect to `localhost:5432`, the `pg` default. On this PC authentication fails, so `/api/health` answers with 500.
- Fix: the user creates it directly. The commands are in "Recovery order" below.

### 4. The API prints a success message even when it cannot open port 3105

- Cause 1: the `listen` callback in `backend/src/server.ts` does not check its error argument. Express 5 passes the error for failing to open the port to this callback too.
- Cause 2: the TCP dynamic port range on this PC is 1024 to 15000 (`netsh int ipv4 show dynamicport tcp`). The Windows default start is 49152. API 3105, Vite 5205, and web 8105 all fall in this range and can overlap with outgoing connections.
- Reproduction: on 2026-11-02 an outgoing browser connection was using local port 3105. Opening `0.0.0.0:3105` gave `EADDRINUSE`. Even so the API printed `API http://localhost:3105`, and a Vite proxy request failed with `ECONNREFUSED`.
- Impact: a port conflict looks like a normal run, so the cause is hard to find. When that connection ends, the conflict goes away, but it can come back.
- Fix: change the `listen` callback to check the error, leave a message, and exit with a failure code, and add a regression test. It is a code change, so it goes in a separate issue.
- User decision: to prevent a recurrence, exclude these ports with `netsh int ipv4 add excludedportrange` as administrator, or restore the dynamic port range. We do not know why the range was narrowed, so we did not change it.

### 5. Local `main` has diverged from the remote

- Cause: the remote history was rewritten. Local `main` (`ea9a8a2`) and the first remote commit (`1087ae2`) have the same tree and differ only in author information. So `git pull --ff-only` fails.
- Impact: we cannot use the standard's post-merge cleanup procedure (`git switch main`, `git pull --ff-only`). The local branch `chore/1-agent-auto-merge`, merged as PR #2, also remains. New work branches from `origin/main`, so it is not blocked.
- Fix: the standard requires the user's approval for these commands, so we did not run them. The user runs or approves the commands in "Recovery order" below.

## Recovery order

We could not use Docker, so we have not run the Docker commands below. After you fix problem 1, run them step by step from the repository root.

**Step 1: create `.env` (problem 3).** After copying, change the passwords of `POSTGRES_PASSWORD` and `DATABASE_URL` to the same value. Change it before going to the next step, because the DB image sets the password only when it first initializes an empty volume. If you use only letters and digits, no URL encoding is needed.

```powershell
Copy-Item .env.example .env
```

**Step 2: create the dedicated test DB (problem 2).** `<password>` is the value you chose in step 1. `money_test` is not initialized automatically, so apply the migrations directly.

```powershell
docker compose up -d --wait db
docker compose exec -T db psql -U money -d money -c "CREATE DATABASE money_test"
docker compose exec -T db sh -c 'for f in /docker-entrypoint-initdb.d/*.sql; do psql -U money -d money_test -v ON_ERROR_STOP=1 -f "$f" || exit 1; done'
$env:TEST_DATABASE_URL = 'postgres://money:<password>@localhost:15405/money_test'
npm run check
```

**Step 3: run the whole app.** The image build needs the package token.

```powershell
$env:NODE_AUTH_TOKEN = (powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gh-project.ps1 auth token --hostname github.com --user sirloinbh)
docker compose up --build -d
Remove-Item Env:NODE_AUTH_TOKEN
```

**Step 4: clean up local branches (problem 5).** This needs the user's approval. Run it when there are no uncommitted changes on a branch other than `main`.

```powershell
git branch --force main origin/main
git switch main
git branch --delete --force chore/1-agent-auto-merge
```

## Verification

Only docs changed. App code and tests did not change.

- `npm run check`: passed. We emptied `TEST_DATABASE_URL` only for this command so that it did not use another app's DB. Backend: 5 of 6 passed and 1 skipped (the DB integration test). Frontend: 58 of 60 passed and 2 skipped. 4 skill tests passed.
- DB integration tests are checked by the PR CI.
- We could not run the Docker commands in the recovery order (problem 1). The basis is `compose.yaml` and `database/README.md`.

## Review record

### Round 1: 8 points, all addressed in follow-up commits

- `ghp` does not exist in a shell without the profile, so we switched to the `scripts/gh-project.ps1` wrapper.
- `psql` could run before the DB was ready, so we changed to `docker compose up -d --wait db`.
- The explanation that it times out when `DATABASE_URL` is missing was wrong, so we corrected it to a 500 response.
- The command that applied only `001` now applies all migrations in name order.
- Added the dynamic port range 1024 to 15000 as a cause of the port conflict.
- Added a "Changes" section to match the prescribed format.
- Split the recovery order into steps so the DB is not initialized before the password is fixed.
- Changed the git commands to the standard's long options.

### Round 2: first-round fixes confirmed (8), 2 points

- The token command did not pick an account, so we added `--hostname github.com --user sirloinbh`.
- A BOM went into the very start of the first-round fix commit title and the PR comment. We fixed the comment. We leave the commit as it is, because force-pushing is prohibited.
- By the standard, we do not run a third review.

## Additional changes: 2026-11-02

- At the user's request we registered the feature issues #34 to #55 and changed the "Priority" table in `docs/next-steps/README.md` to use those numbers.
