# Development environment setup for a new web app project: handoff document for AI agents

This document is the instruction set to hand as-is to the **AI agent that will set up a new web app project** (Claude Code, Codex, and so on). It is based on the development environment actually operated and verified in `sirloinbh/workout-memo`. The agent reads this document from start to finish, then proceeds in the order of [11. Bootstrap checklist](#11-bootstrap-checklist).

- Reference date: 2026-10-19 (Asia/Seoul). The version numbers are values whose real behavior was confirmed on that day. When you start a new project, recheck the official support status, and record the reason if you change a version.
- Notation: **[Currently applied]** means installed and in use in workout-memo, and **[Recommended, not adopted]** means reviewed only and not yet installed. Do not treat a tool that is not adopted as if it were installed.

## 0. Values to confirm with the user before starting

The placeholders below differ for each project. If a value is not decided, **ask the user before you start the setup.** Do not decide it arbitrarily.

| Placeholder               | Meaning                                                             | workout-memo example                                                                     |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `<app>`                   | App and repository base name (lowercase, hyphens)                   | `workout-memo`                                                                           |
| `<App display name>`      | Name used on screens and in docs                                    | `FORM · 나의 운동 기록`                                                                  |
| `<owner>`                 | GitHub account (personal or organization)                           | `sirloinbh`                                                                              |
| `<db>`                    | PostgreSQL DB and user name                                         | `workout`                                                                                |
| `<web-port>`              | Production-style local web port (bound to 127.0.0.1)                | `8088` (avoids conflicts with common ports such as 8080)                                 |
| `<db-port>`               | DB port reached from the host                                       | `55432` (avoids a conflict with the default 5432)                                        |
| `<api-port>`              | Internal API port                                                   | `3001`                                                                                   |
| `<timezone>`              | Service reference time zone                                         | `Asia/Seoul`                                                                             |
| `<region>`                | AWS region                                                          | `ap-northeast-2` (Seoul)                                                                 |
| `<budget-usd>`            | Monthly AWS budget alert threshold                                  | `20`                                                                                     |
| Users and login           | Number of users, whether login is needed                            | Single user, no login → never expose externally                                          |
| Domain rules              | Core rules such as dates, units, and handling of unconfirmed values | Dates `YYYY-MM-DD`, weight is total weight in kg, unconfirmed values are NULL            |
| GitHub account separation | Whether a work account and a personal account are mixed             | The default `gh` is the work account, and this project uses the personal-account wrapper |

## 1. Absolute rules (constraints on agent behavior)

Copy these as they are into the new project's `AGENTS.md` too.

1. **Install or remove npm packages only after the user reconfirms.** The 2025 to 2026 npm supply chain attacks (the Shai-Hulud family) steal tokens through `postinstall` hooks. This covers `npm install/i/add/uninstall/update/ci`, `npx <package>`, `pnpm/yarn/bun install`, and `corepack enable/prepare`. If an install is needed, follow this order.
   - Show the user the package list with the publisher, the latest release, and the GitHub repository, and recommend checking socket.dev, Snyk Advisor, and deps.dev.
   - Run it only when the user explicitly says "I understand the risk, go ahead". Propose `--ignore-scripts` first.
   - Only for packages whose build truly needs an install script (for example `esbuild`), list them explicitly in `allowScripts` in `package.json`.
   - Commands that do not install anything, such as `npm run <script>`, `npm ls`, and `npm view`, are allowed.
2. **A PR goes through automatic code review at most 2 times, and the agent merges it after all required CI checks pass.** If the review finds something to fix, address it in a follow-up commit, and after the first round of fixes get one more review. After the second round of fix commits, do not review again. If nothing needs fixing, go straight to the next step. Split a fix that is too big for this PR into a new issue card. Without asking for confirmation again, run `pr merge <url> --merge --match-head-commit <verified head SHA>` (merge commit) with the project wrapper, and check that the linked issue is closed. Do not merge a PR that has failing or running checks, bypass branch protection with `--admin` or similar, replace a review by approving your own PR, commit or push directly to `main`, or force-push.
3. **Do not put secrets in the repository, docs, PRs, or logs.** This covers `.env`, tokens, real backups, and Terraform state. Commit only `.env.example`.
4. **Do not overwrite the user's changes.** Do not use `git add -A`; stage files explicitly. Check the target before reverting or deleting.
5. **Do not report a check you did not run as passed.** Record skipped DB tests, browser checks not done, and things not deployed separately.
6. **If a requirement is missing, ask.** For rules that must be decided before implementation (aggregation method, policy, scope), confirm them with the user together with a recommendation and record them in the issue.

## 2. Language and document rules

- User conversation, screen text, and documents (README, docs, issues, PRs) are written in **English** (the user set this on 2026-11-12; the earlier version of this document said Korean). Code identifiers, commit title prefixes (`feat:` and so on), and code comments are English. Screen text and validation messages that the user sees are covered by `sirloinbh/project-standards#457`.
- Set a validation error message that the user sees explicitly. Give the message, like `.min(1, '…')`, so that Zod's default English messages ("Array must contain…") are not shown on the screen as they are.
- Dates are `YYYY-MM-DD`, and the service time zone is `<timezone>`. The server's "today" is computed in the service time zone, not the server's time zone.
- Document locations:
  - `docs/changes/<issue-number>-<slug>.md`: change record per issue. Keep the purpose, the changes, the real verification commands with pass/fail/skip, and the limits.
  - `docs/daily/YYYY-MM-DD.md`: summary of the working day. Accumulate by date and add the list to `docs/daily/README.md`.
  - `docs/next-steps/README.md`: the latest priorities, blockers, and next actions. Update it every day.

## 3. Tech stack

### 3.1 [Currently applied] Versions and roles

| Area              | Choice                                              | Version (pinned or range)                                  | Role                                                   |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Runtime           | Node.js / npm                                       | `24.21.0` / `11.19.0` (pinned exactly)                     | Same for development, CI, and Docker                   |
| Package structure | npm workspaces                                      | Root + `frontend`, `backend`                               | One root lockfile + a lockfile for each sub-repository |
| Frontend          | React, React DOM                                    | `^19.1.0`                                                  | SPA                                                    |
|                   | Vite                                                | `^6.3.5`                                                   | Dev server and build, `/api` proxy                     |
|                   | TypeScript                                          | `^5.8.3`                                                   | `strict`                                               |
|                   | lucide-react                                        | `^0.468.0`                                                 | Icons                                                  |
| Backend           | Express                                             | `^5.1.0`                                                   | REST API                                               |
|                   | pg (node-postgres)                                  | `^8.16.0`                                                  | Hand-written SQL, no ORM                               |
|                   | Zod                                                 | `^3.25.0`                                                  | Server input validation                                |
|                   | tsx                                                 | `^4.19.0`                                                  | Dev run (`watch`) and test run                         |
| DB                | PostgreSQL                                          | `17` (`postgres:17-alpine`)                                | Single DB                                              |
| Web server        | nginx                                               | `1.27-alpine`                                              | Static files + `/api` reverse proxy                    |
| Code quality      | ESLint / typescript-eslint / react-hooks / Prettier | `10.12.0` / `8.71.2` / `7.1.1` / `3.9.10` (pinned exactly) | Warnings fail too                                      |
|                   | `@eslint/js`, `eslint-config-prettier`, `globals`   | `10.0.1`, `10.1.8`, `16.5.0`                               |                                                        |
| Dev convenience   | concurrently                                        | `^9.2.0`                                                   | Run API and web together                               |
| Tests             | `node:test` + `tsx --test`                          | Built into Node                                            | Unit, DB integration, and UI (chapter 6 below)         |
| Containers        | Docker Compose                                      | -                                                          | 3 services: db, api, web                               |
| CI                | GitHub Actions                                      | -                                                          | Full checks + DB integration + Docker build            |
| Infrastructure    | Terraform / AWS provider                            | `>= 1.6.0` / `~> 5.0`                                      | ECR and budget alerts (deployment not connected)       |

### 3.2 [Recommended, not adopted] Candidates to adopt when needed

| Area         | Candidate                                 | When to adopt                                                                                      |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Routing      | React Router                              | When there are more than 4 or 5 screens and URL sharing and back navigation are needed             |
| Server state | TanStack Query                            | When fetch, cache, and refresh-after-save code starts repeating                                    |
| Forms        | React Hook Form + Zod                     | When array input and per-item errors get complicated                                               |
| UI           | Tailwind CSS + shadcn/ui                  | When shared components grow. Move the existing design tokens first                                 |
| Charts       | Recharts                                  | When hand-drawn SVG charts are not enough                                                          |
| Tests        | Vitest, React Testing Library, Playwright | When automatic browser regression is needed. Do not rip out the existing `node:test` for no reason |
| API contract | OpenAPI                                   | When external clients appear                                                                       |
| ORM          | Prisma                                    | Only when the user asks for an ORM switch. Do not split the source of the migrations in two        |

If you want to use the candidates above from the very start of a new project, get the user's confirmation as in rule 1 of chapter 1 before adopting them. When you adopt one, align the run commands, CI, and docs in the same PR.

## 4. Repository structure and splitting into repositories

### 4.1 Umbrella monorepo + deploy sub-repositories

- Develop all source in **one umbrella monorepo `<owner>/<app>`.** Issues, branches, PRs, and reviews all happen here.
- The 4 per-area repositories are synced with `git subtree split` **only for deployment and sharing.** During everyday PR work, do not push directly to a sub-repository or to `main`.

| Prefix folder     | Sub-repository (private)            | Contents                                      |
| ----------------- | ----------------------------------- | --------------------------------------------- |
| `frontend/`       | `<owner>/<app>-frontend`            | React app, Dockerfile, nginx.conf, its own CI |
| `backend/`        | `<owner>/<app>-backend`             | Express API, Dockerfile, its own CI           |
| `database/`       | `<owner>/<app>-db`                  | SQL migrations, README                        |
| `infrastructure/` | `<owner>/shared-aws-infrastructure` | Terraform shared by several apps, its own CI  |

- First creation: `scripts/create-repositories.ps1 -Owner <owner>`. It creates 5 repositories, splits each prefix folder into an `export/<part>` branch, and pushes it to the sub-repository's `main`.
- Sync: `scripts/push-repositories.ps1`. Run it **only when the user asked for a sync** (it also pushes the umbrella `main`).
- If you edited a sub-repository directly, first pull it in with `git subtree pull --prefix=<part> <url> main --squash`.
- So that a sub-repository builds on its own, keep a `package-lock.json`, `.github/workflows/ci.yml`, `.gitignore`, and `.dockerignore` of its own in `frontend/` and `backend/`.

### 4.2 Directory layout

```text
<app>/
├─ AGENTS.md                 # Shared AI instructions (Codex baseline, Claude reads it too)
├─ CLAUDE.md                 # [Recommended] "Follow AGENTS.md" + Claude-only differences
├─ README.md
├─ package.json              # workspaces, shared scripts, lint and format tools
├─ package-lock.json
├─ .nvmrc / .node-version    # 24.21.0
├─ .npmrc  .editorconfig  .gitattributes  .gitignore
├─ .prettierrc.json  .prettierignore  eslint.config.mjs
├─ .env.example              # Example without secrets only
├─ compose.yaml
├─ .github/workflows/ci.yml  # Integrated CI
├─ frontend/  backend/  database/  infrastructure/
├─ scripts/                  # Scripts for repository creation, sync, backup, and checks
├─ skills/<app>-*/SKILL.md   # Source of the AI work procedures
├─ .claude/skills/           # Copy for Claude Code (npm run skills:sync)
└─ docs/  changes/  daily/  next-steps/
```

- `.local/` is for local tools, temporary worktrees, and logs. Exclude it from Git and Prettier.
- As features grow, do not keep every screen in the single `frontend/src/main.tsx`; split into per-feature modules (`routines.tsx`, `body.tsx`, and so on). In workout-memo `main.tsx` grew large and concurrent PRs conflicted often.

## 5. Key configuration files

Below is the real content used in workout-memo. Replace only the names and ports with placeholders.

### 5.1 Runtime, editor, and line endings

`.nvmrc`, `.node-version`

```text
24.21.0
```

`.npmrc`: block installs on an engine mismatch, and save dependency versions exactly.

```ini
engine-strict=true
save-exact=true
```

`.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.gitattributes`: LF in the repository, CRLF only for PowerShell scripts.

```text
* text=auto eol=lf
*.ps1 text eol=crlf
```

### 5.2 Root `package.json`

```json
{
  "name": "<app>",
  "private": true,
  "workspaces": ["frontend", "backend"],
  "scripts": {
    "dev": "concurrently -k \"npm run dev -w backend\" \"npm run dev -w frontend\"",
    "build": "npm run build -w frontend && npm run build -w backend",
    "test": "npm run test -w backend",
    "test:skills": "node --test scripts/test/claude-skills.test.mjs",
    "skills:sync": "node scripts/claude-skills.mjs sync",
    "skills:check": "node scripts/claude-skills.mjs",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:skills && npm run build",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "npm run typecheck --workspaces"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "concurrently": "^9.2.0",
    "eslint": "10.12.0",
    "eslint-config-prettier": "10.1.8",
    "eslint-plugin-react-hooks": "7.1.1",
    "globals": "16.5.0",
    "prettier": "3.9.10",
    "typescript-eslint": "8.71.2"
  },
  "allowScripts": { "esbuild@0.28.2": true, "esbuild@0.25.12": true },
  "engines": { "node": "24.21.0", "npm": "11.19.0" },
  "packageManager": "npm@11.19.0"
}
```

One `npm run check` runs everything: format → lint → types → tests → build. **Always run it before committing and before creating or updating a PR.** If you have a local AI worker, add `test:agents` to `check` (see workout-memo).

### 5.3 Format and lint

`.prettierrc.json`

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

`.prettierignore`

```text
node_modules/
**/dist/
.local/
.git/
.env
package-lock.json
**/package-lock.json
infrastructure/.terraform/
**/*.tfstate*
backups/
.bkit/
.playwright-mcp/
```

`.bkit/` and `.playwright-mcp/` are local outputs created by Claude Code plugins and browser tools. If Prettier checks these folders, `npm run check` fails.

`eslint.config.mjs`

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '.local/**', 'infrastructure/.terraform/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  prettier,
);
```

Code rules: write React components and types in PascalCase, and variables and functions in camelCase. Prefix an argument that you must declare but do not use (such as in an Express error middleware) with `_`. At error boundaries, receive the value as `unknown` and check only the fields you need.

### 5.4 `.gitignore`

```text
node_modules/
dist/
.env
*.log
.terraform/
*.tfstate*
*.tfplan
backups/
.local/
.bkit/
.playwright-mcp/
```

### 5.5 TypeScript

`frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`backend/tsconfig.json` (build) and `backend/tsconfig.check.json` (type-check including tests)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }
```

### 5.6 Workspace `package.json` scripts

- frontend: `"dev": "vite --host 127.0.0.1"`, `"build": "tsc --noEmit && vite build"`, `"typecheck": "tsc --noEmit"`
- backend: `"dev": "tsx watch --env-file-if-exists=../.env src/server.ts"`, `"start": "node dist/server.js"`, `"build": "tsc"`, `"test": "tsx --test test/*.test.ts"`, `"typecheck": "tsc -p tsconfig.check.json"`
- Both workspaces have `engines`, `packageManager`, and `"allowScripts": { "esbuild": true }`.

`frontend/vite.config.ts`

```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': 'http://127.0.0.1:<api-port>' } } });
```

### 5.7 Docker Compose and images

`compose.yaml`: bind all ports only to `127.0.0.1` (protects an app with no login).

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-<db>}
      POSTGRES_USER: ${POSTGRES_USER:-<db>}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Copy .env.example to .env and set password}
      TZ: <timezone>
    ports: ['127.0.0.1:<db-port>:5432']
    volumes:
      - <app>-data:/var/lib/postgresql/data
      - ./database/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U $$POSTGRES_USER -d $$POSTGRES_DB']
      interval: 5s
      timeout: 5s
      retries: 15
    restart: unless-stopped
  api:
    build: ./backend
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-<db>}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-<db>}
      PORT: <api-port>
      TZ: <timezone>
    depends_on:
      db: { condition: service_healthy }
    restart: unless-stopped
  web:
    build: ./frontend
    ports: ['127.0.0.1:<web-port>:80']
    depends_on: [api]
    restart: unless-stopped
volumes:
  <app>-data:
```

`.env.example`

```ini
POSTGRES_DB=<db>
POSTGRES_USER=<db>
POSTGRES_PASSWORD=change-this-local-password
DATABASE_URL=postgres://<db>:change-this-local-password@localhost:<db-port>/<db>
PORT=<api-port>
```

`backend/Dockerfile`: split build and run, and run the run stage as a non-root (`node`) user.

```dockerfile
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --global npm@11.19.0
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE <api-port>
CMD ["node", "dist/server.js"]
```

`frontend/Dockerfile` + `frontend/nginx.conf`

```dockerfile
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --global npm@11.19.0
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  location /api/ { proxy_pass http://api:<api-port>; proxy_set_header Host $host; }
  location / { try_files $uri $uri/ /index.html; }
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy same-origin always;
}
```

## 6. Backend and DB implementation rules

### 6.1 API structure

- `createApp(pool)` builds and returns the Express app, and `server.ts` only calls `listen`. Then tests can start the app with a real DB pool or a fake pool. To pin "today" in tests, provide an injection point such as `createApp(pool, { today })`.
- `app.disable('x-powered-by')`, `express.json({ limit: '256kb' })`. Only for a large upload route (for example backup restore), raise the limit separately on that route.
- Validate every input with Zod before touching the DB. A shared error middleware turns `ZodError` into 400 and a unique constraint violation (23505) into 409, and returns the user-facing messages.
- Check health with `GET /api/health`.
- Receive the pg `date` type (OID 1082) as a string: `types.setTypeParser(1082, (v) => v)`. This prevents it from turning into a JS `Date` and shifting by time zone.
- Wrap a change that writes several rows (a log plus its sets, and so on) in `BEGIN … COMMIT` on one client, `ROLLBACK` on error, and `release()` in `finally`.
- Every query uses parameters (`$1`). If you must build a table or column name as a string, use only constants.

### 6.2 Save safety patterns (apply to apps that need them)

- **Idempotent retries:** the client attaches a UUID `Idempotency-Key` to POST and PUT.
  - Inside a transaction, the server serializes the same key with `pg_advisory_xact_lock(hashtextextended(key))`.
  - It stores the request fingerprint (method, target, and the SHA-256 of the normalized body) and the response, and returns the same response for the same request.
  - Using the same key with different content is rejected with 409.
- **Concurrent edit conflicts:** keep a `version` on the row, run `SELECT … FOR UPDATE`, and compare versions. If they differ, return 409; if they match, update with `version+1`.
- **Browser drafts:** keep what is being typed in `localStorage` (for example for 7 days) and show the save state. Wrap all storage access in `try/catch` (private mode, quota exceeded).

### 6.3 DB and migrations

- PostgreSQL 17. Keep the migration source in **one place only**: `database/migrations/NNN_<description>.sql`.
- Number them with a 3-digit sequence. **To keep parallel branches from using the same number, reserve the number when work starts.** In workout-memo, PRs opened at the same time once used `003` twice.
- Write every migration so it is safe to run again: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `INSERT … ON CONFLICT DO NOTHING/UPDATE` for seed data.
- Preserve the meaning of existing data. For example, give a new `completed` column a default of `true` so the judgment of past records does not change.
- How to apply:
  - Empty volume: Compose runs all files in `/docker-entrypoint-initdb.d` automatically in name order.
  - CI: apply all files in name order with `psql -v ON_ERROR_STOP=1 -f`.
  - **Existing DB: run the file mounted in the container directly.**

    ```powershell
    docker compose exec -T db psql -U <db> -d <db> -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/NNN_<description>.sql
    ```

    **Do not pass it through a PowerShell pipe** such as `Get-Content … | docker compose exec … psql`. When piping to an external program, Windows PowerShell 5.1 sends ASCII, so Korean text is corrupted into `?`. In workout-memo we reproduced the `'기타'` ("Other") brand being stored twice as `'??'`. If you must pipe, first set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`.
- Write Korean literals in SQL (CHECK values and so on) with Unicode escapes like `U&'\AC00\C2B4'` where possible. This is safe regardless of how the file is applied.
- State the unit and NULL rules in the schema. Leave unconfirmed values NULL and distinguish them from 0. Set numeric precision with `NUMERIC(p,s)`.
- Backup: `scripts/backup.ps1` saves `pg_dump --no-owner --no-acl` to a UTF-8 (no BOM) file. Keep `backups/` out of Git, store a copy in a safe place off the PC too, and check restores regularly.

## 7. Tests and CI

### 7.1 Testing principles

- Put tests in the same commit as the implementation or fix. For a bug fix, add a regression test with **fails before the fix, passes after the fix** confirmed.
- Do not repeat the internal implementation; verify the results the user sees and the domain rules.
- Do not make a failing test pass by skipping it, deleting it, or weakening its judgment.

### 7.2 Test kinds [Currently applied]

| Kind           | Tool and method                                                                                                                                         | File example                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Unit           | `node:test` + `assert/strict`, `tsx --test`                                                                                                             | `backend/test/*.test.ts`          |
| DB integration | Real PostgreSQL. **Skipped** when `TEST_DATABASE_URL` is missing. A skipped test is not counted as passed                                               | `*.integration.test.ts`           |
| UI             | Load components with `vm.runInNewContext` + `ts.transpileModule`, and check the render result with a fake React, `fetch`, `localStorage`, and clock     | `*-ui.test.ts`                    |
| Browser        | Real dev server + Playwright (MCP) checks at mobile 390px and PC 1440px. It is a manual check before the PR, not a replacement for automatic regression | Record the result in docs/changes |

- Run DB integration tests only on a **dedicated test DB, not the user's DB.** So that parallel work does not interfere, use a DB per branch (issue) or a schema per test.
- For tests that depend on dates, inject "today" or pin it with a fake `Date`.

### 7.3 Integrated CI (`.github/workflows/ci.yml`)

```yaml
name: Verify application
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_USER: <db>, POSTGRES_PASSWORD: test, POSTGRES_DB: <db> }
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24.21.0', cache: npm }
      - run: npm install --global npm@11.19.0
      - run: npm ci
      - run: |
          for migration in database/migrations/*.sql; do
            psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" || exit 1
          done
        env: { TEST_DATABASE_URL: 'postgres://<db>:test@localhost:5432/<db>' }
      - run: npm run check
        env: { TEST_DATABASE_URL: 'postgres://<db>:test@localhost:5432/<db>' }

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t <app>-frontend:ci ./frontend
      - run: docker build -t <app>-backend:ci ./backend
```

`npm ci` inside the CI runner installs from the lockfile in an isolated GitHub environment, so it is separate from the rule against local installs. The CI for the sub-repositories is as follows.

- `frontend/.github/workflows/ci.yml`: `npm ci` → `npm run build` → `docker build`
- `backend/.github/workflows/ci.yml`: `npm ci` → `npm run build` → `npm test` (unit tests without a DB, integration skipped) → `docker build`
- `infrastructure/.github/workflows/ci.yml`: `terraform init -backend=false && terraform validate`

## 8. Design system

workout-memo has a calm green "workout notebook" tone. A new project also starts from the tokens and components below unless told otherwise. In a new project, define the values as **CSS variables (`:root`)** from the start. workout-memo wrote colors directly, so it was hard to share them later.

### 8.1 Tokens

| Token                 | Value                                                           | Use                                        |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Font                  | `'DM Sans', 'Noto Sans KR', sans-serif` (Google Fonts)          | DM Sans for Latin, Noto Sans KR for Korean |
| Base font size        | `14px`, `font-synthesis: none`                                  |                                            |
| Body color            | `#25372f`                                                       | Text                                       |
| Page background       | `#f7f8f5`                                                       |                                            |
| Sidebar background    | `#fcfcfa`, divider `#e5e8e1`                                    |                                            |
| Primary color         | `#294432` background / `#f3f7ec` text                           | Primary button                             |
| Accent (focus)        | `#a1bd56`                                                       | `:focus-visible` 3px outline, 3px offset   |
| Card                  | background `#fff`, border `#e3e7dd`, radius `9px`               |                                            |
| Modal                 | background `#fcfdf9`, radius `12px`, shadow `0 20px 80px #0003` |                                            |
| Secondary background  | `#f4f6ef`, `#eaf0df`                                            | Tabs and hint boxes                        |
| Muted text            | `#9aa48f`                                                       | Secondary description                      |
| Warning background    | `#fff0e9`                                                       | Errors                                     |
| Button radius         | `6px`, padding `12px 17px`, text `12px/500`                     |                                            |
| Theme color (browser) | `<meta name="theme-color" content="#182b26">`                   |                                            |

### 8.2 Layout and components

- **Shell:** a fixed left sidebar (`aside`, 234px wide, logo, navigation, and profile) and the content on the right. Put a breadcrumb at the top ("My workspace › Screen").
- **Page header:** a small uppercase line (eyebrow) + a large title + a description + the primary button on the right.
- **Period bar:** tabs (1 day, 1 week, 1 month, 4 weeks, 12 weeks) + previous/next + a date input.
- **Stat card:** a label, a large number + unit, and a supporting description below.
- **Card and list row:** a date tile, a title, a summary, and the figures, edit, and delete on the right.
- **Three button kinds:** `primary` (main action), `subtle-button` (secondary), and `text-button` (weak action). Use lucide-react for icons, and always give an icon-only button an `aria-label`.
- **Modal form:** a 2-column `form-grid`, with the label wrapping the input (`<label>text<input/></label>`). Input hints use `form-hint`.
- **Status display:** save status uses `role="status"`, errors use `role="alert"`, toggles use `aria-pressed`, and the empty state shows a message (title + description + action button).
- **Charts:** draw them directly with SVG and CSS without a library, and give them `role="img"` and an `aria-label` that summarizes the values. Do not connect days without a value as if they were 0.

### 8.3 Responsive and verification

- Breakpoints: `min-width: 1500px` (wide screens), `max-width: 1100px` (tablet), `max-width: 760px` (mobile).
- A PR that changes screens is checked in a real browser at **mobile 390×844 and PC 1440×900**. Check that there is no horizontal scroll (`scrollWidth > innerWidth`), and record the result in docs/changes.
- Fix problems found in browser checks (double-click toggles, the screen not refreshing after save, and so on) together with a regression test.

## 9. Git strategy

- **GitHub Flow:** keep `main` always deployable. Every change starts from an issue.
- **Order:** register a GitHub issue → branch named with the issue number → implementation, tests, and the `docs/changes` record in the same commit → `npm run check` → PR → automatic code review (at most 2 rounds) → CI check → **agent merge after CI passes**.
- **Issue:** write the purpose, the scope, the done criteria (checkboxes), the verification method, and the boundaries. Leave rules that must be decided as "Decisions before implementation", and when the user decides, record the confirmed rule as an issue comment. Write the body to a UTF-8 file and register it with `gh issue create --body-file`.
- **Branch:** `<type>/<issue-number>-<slug>`. The type is `feat`, `fix`, `docs`, or `chore` (for example `feat/12-workout-editor`). If a branch for the same issue already exists, continue on it.
- **Commit title:** `feat: <English summary> (#12)`. Write the reason in the body. If an AI co-authored it, add a `Co-Authored-By:` line.
- **PR:** the target is `main`. Put the following in the body.
  - A summary, the main changes, and the real check commands with pass/fail/skip
  - Results of screen-change checks, and the points of judgment and points that need confirmation
  - `Closes #N` (`Refs #N` if it is a partial implementation)

  If verification remains, leave it as a draft. If a PR for the same branch exists, update it rather than creating a new one.

- **Review:** after you open the PR, go through automatic code review at most 2 times. If the review finds something to fix, address it in a follow-up commit, and after the first round of fixes get one more review. After the second round of fix commits, do not review again. If nothing needs fixing, go straight to the next step. Split a fix that is too big for this PR into a new issue card. Leave the result of each round in a PR comment and in the `docs/changes` record.
- **Merge:** when all required CI checks of the final head pass, the agent merges with a merge commit (`--merge --match-head-commit <head SHA>`). Merge stacked PRs in order. After the earlier PR is merged, merge `origin/main` into the later PR branch to resolve conflicts, confirm with tests that both sides' features survive, push normally, and merge after CI passes. If you wire the main merge to trigger a deployment, also check the deployment result after the merge.
- **Parallel work:** use a separate `git worktree` for each issue. Avoid a shared stash, and split migration numbers and test DBs per issue.

## 10. AI instruction system

### 10.1 File roles

| File                                                       | Role                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                | Shared instructions for all agents. Work procedure, project baseline (ports, time zone, units), verification commands, prohibitions, and account rules |
| `CLAUDE.md` [Recommended]                                  | The file Claude Code reads automatically. Briefly write "This project follows `AGENTS.md`" + only the Claude-specific differences                      |
| `skills/<app>-implementation/SKILL.md`                     | Procedure: issue → branch → implementation and docs → tests → PR → automatic review (at most 2 rounds) → merge after CI passes                         |
| `skills/<app>-testing/SKILL.md`                            | Standard for writing, running, and recording tests                                                                                                     |
| `skills/<app>-foundation/SKILL.md` + `references/stack.md` | Development foundation, tech recommendations, and the order of adoption                                                                                |
| `.claude/skills/`                                          | Copy of `skills/` for Claude Code. Edit only the source and refresh with `npm run skills:sync`; `npm run check` fails on a mismatch                    |

- The single source of the skills is the repository's `skills/`. Codex installs them in the `skills/` of the Codex home, and Claude Code reads `.claude/skills/`.
- A skill file has YAML front matter (`name`, `description`). After a change, check it with skill-creator's `quick_validate.py` (`PYTHONUTF8=1` on Windows).
- Do not use repository-relative path links in a skill body, so that the links do not break when the copy is in a different place.

### 10.2 Items to put in `AGENTS.md` (template)

```markdown
# <App display name> project instructions

## Implementation procedure

For requests to change features, fixes, refactoring, settings, docs, or skills, follow skills/<app>-implementation/SKILL.md.

1. Register an issue in <owner>/<app> (reuse an existing issue the user named).
2. Create a `<type>/<issue-number>-<slug>` branch.
3. Write the implementation and tests together and include a docs/changes/<issue-number>-<slug>.md record in each commit.
4. Run `npm run check` before committing and before creating or updating a PR, and record the result in the docs and the PR.
5. **After the PR, go through automatic code review at most 2 times (split a big fix into a new issue card), and when all required CI checks pass, the agent merges the PR (`--merge --match-head-commit`).**
   Answering questions, recommendations, and read-only investigation do not create an issue or a branch.

## Project baseline

- Tech: React + Vite + TypeScript, Express + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions.
- Web port <web-port>, host DB port <db-port> (bound to 127.0.0.1). Do not change them without a user request.
- Dates YYYY-MM-DD, time zone <timezone>. <Domain unit and NULL rules>.
- Do input validation and judgment on the server too. Use a transaction for multi-row changes.
- Do not commit or record .env, tokens, real backups, or Terraform state.
- Do not overwrite user changes, and stage only the files you need.
- Install or remove npm packages only after the user reconfirms, with --ignore-scripts first.
- Sub-repository sync (scripts/push-repositories.ps1) and AWS deployment only on a separate request.

## Verification commands

- Full: `npm run check`. DB integration: set `TEST_DATABASE_URL` for a dedicated DB and run `npm test` (skipped when unset = not verified).
- Infrastructure: `terraform validate`. Docs or skills only: format, link, and skill validators.

## Docs

- docs/changes (per issue), docs/daily (summary of the working day), docs/next-steps (the latest next steps).
```

### 10.3 Account separation (a PC that uses a work account and a personal account together)

- Leave the default `gh` alone and use a project-specific wrapper (`scripts/gh-project.ps1`). The wrapper clears an inherited `GH_TOKEN` or `GITHUB_TOKEN` and applies the token obtained with `gh auth token --user <owner>` to that call only.
- For Git push, set the wrapper as this repository's **local** credential helper. Do not change the global helper.
- Before remote work, check that `<wrapper> api user --jq .login` is `<owner>`. Do not work around it with another account.
- Run the wrapper inside a git repository. It fails when run outside one.
- Pick a Codex personal profile with the `CODEX_HOME` environment variable. For the detailed implementation, see workout-memo's `docs/project-github-auth.md`.

### 10.4 [Optional] Local AI worker

workout-memo runs a worker (`scripts/agents.ps1`) that takes a confirmed issue from a queue and handles tests → implementation → independent review → checks → PR on the PC automatically. A new project does not need it from the start. When you adopt one, keep the following in mind.

- Pin a model for each role (for example a top-tier model for planning, debugging, and high-risk review, and a standard model for tests, implementation, and review). Do not switch to another model arbitrarily.
- Test the per-issue worktree, the locks, and the state transitions (`npm run test:agents`).
- **Inside a sandbox, the Vite/esbuild build can fail because of a permission problem reading the parent folder.** Run the final `npm run check` on the host.
- Details: workout-memo's `docs/local-agent-workflow.md`.

## 11. Bootstrap checklist

Pass the "Check" at the end of each step before you go to the next.

1. **Fix the values:** get the placeholders of chapter 0 from the user. Check: the table is fully filled.
2. **Account and remote:** confirm the GitHub account to use, and prepare the wrapper in 10.3 if needed. Check: `api user --jq .login` = `<owner>`.
3. **Runtime:** pick Node 24.21.0 / npm 11.19.0 (with a user tool such as nvm or Volta; do not change the system Node arbitrarily). Check: `node -v`, `npm -v`.
4. **Skeleton files:** create the structure in 4.2, the configuration files in chapter 5, `.env.example`, `compose.yaml`, the Dockerfiles, nginx.conf, and `database/migrations/001_initial.sql` (minimal tables).
5. **Install dependencies (user confirmation required):** show the package list in 3.1, get approval by the procedure in rule 1 of chapter 1, then install. Check: `package-lock.json` and each workspace lockfile were created.
6. **Minimal feature:** create `createApp(pool)`, `GET /api/health`, 1 baseline screen, 1 unit test, 1 DB integration test, and 1 UI test.
7. **Local verification:**
   - Start the DB with `docker compose up -d db`.
   - Create the dedicated test DB and apply all migrations with `psql -f`.
   - Set `TEST_DATABASE_URL` and run `npm run check`.

   Check: exit 0 and the DB tests were not skipped.

8. **Run the containers:** create `.env` and run `docker compose up --build -d`. Check: the screen at `http://localhost:<web-port>` and the `/api/health` response are normal.
9. **AI instructions:** create `AGENTS.md`, `CLAUDE.md`, the 3 skills, the `.claude/skills` sync script, and its test from chapter 10. Check: `npm run check` includes `test:skills` and passes.
10. **Docs:** create the README (run, verification, repository layout), `docs/development-baseline.md`, `docs/changes/`, `docs/daily/`, and `docs/next-steps/`.
11. **Create the repositories:** after user approval, create the umbrella repository and the 4 sub-repositories as private with `scripts/create-repositories.ps1 -Owner <owner>`. Check: the CI of each repository passes.
12. **Draft infrastructure:** put the Terraform of chapter 12 in `infrastructure/` and run `terraform init -backend=false && terraform validate`. Run a real `apply` only when the user asks for deployment.
13. **GitHub Flow from the first issue:** from here on, do every change by the procedure in chapter 9.

## 12. AWS infrastructure

### 12.1 [Currently applied] Shared Terraform draft (`infrastructure/`)

- Region `<region>` (default `ap-northeast-2`) and a `project` variable (default `shared-apps`) are shared by several apps.
- **ECR:** a frontend and a backend repository per app (`for_each`), immutable tags (IMMUTABLE), image scan on push, AES256 encryption, and a lifecycle policy that keeps only the latest 10.
- **AWS Budgets:** `<budget-usd>` USD per month, an email when actual spend exceeds 80%. A budget alert **does not stop spending.**
- Run: `terraform init` → `terraform plan -var='budget_email=…'` → `terraform apply …`. **Do not put the state file in Git** (it may contain sensitive data).
- To add another app, add its name to the ECR `for_each` list.

```hcl
terraform {
  required_version = ">= 1.6.0"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
provider "aws" { region = var.region }
```

### 12.2 Deployment alternatives (not connected yet, cost estimated from the official Seoul region prices on 2026-10-15)

| Alternative                              | Setup                                                                   | Monthly cost (before tax)                                                    | Notes                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Shared server (several personal apps) | One Lightsail instance with Docker Compose + PostgreSQL, ECR, snapshots | 2 GB: about $13.50 / 4 GB: about $25.50 (whole server)                       | 0.5 to 1 GB leaves too little headroom. Separate the DB or schema and permissions per app |
| 2. App server + managed DB               | EC2/Lightsail + RDS PostgreSQL                                          | The user's initial budget of 30,000 to 60,000 KRW or more (not a firm quote) | Less backup and maintenance burden                                                        |
| 3. Managed scale-up                      | ECS Fargate + ECR + RDS + ALB                                           | High fixed cost                                                              | When traffic and availability are needed                                                  |
| Static frontend only                     | Amplify and similar                                                     | Calculated separately                                                        | API and DB are needed separately                                                          |

- **Do not expose an app without login directly to the public internet.** Design a VPN, private access, or authentication first.
- Things to prepare together when you deploy: HTTPS, remote state (S3 + locking), a GitHub OIDC deploy role (no long-lived keys), image version tags, health checks, CloudWatch log retention, backup and restore procedures, and a way to roll back to the previous image.
- Detailed cost calculation: workout-memo's `docs/shared-hosting-costs.md`.

## 13. Pitfalls found in this project

| Symptom                                                                  | Cause                                                              | Response                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Korean is stored as `?` in the DB and re-applying creates duplicate rows | PowerShell 5.1 pipes send ASCII                                    | Run the mounted file with `psql -f`, or set `$OutputEncoding` to UTF-8, and write SQL with `U&` escapes              |
| Only the build of `npm run check` fails in an AI sandbox                 | Vite/esbuild cannot read the parent folder (shared `node_modules`) | Run the final check on the host and record the result                                                                |
| The Prettier check suddenly fails                                        | Tool outputs such as `.bkit/` and `.playwright-mcp/`               | Add them to `.gitignore` and `.prettierignore`                                                                       |
| Parallel PRs use the same migration number                               | Each branch picks its own next number                              | Reserve the number when work starts                                                                                  |
| Several PRs keep conflicting in the same big file (`main.tsx`, `app.ts`) | Screens and routes are collected in one file                       | Split into per-feature modules, and in a later PR merge `main` and confirm with tests that both sides' features work |
| A double click on a toggle button reverts the state                      | The two clicks are handled in different renders                    | Ignore an opposite action within a short time + a regression test                                                    |
| Data saved on another screen does not show when you come back            | The screen does not reload on entry                                | Refetch on screen change                                                                                             |
| A server validation error is shown as the Zod default                    | Zod default message                                                | Give explicit messages for validation the user sees                                                                  |
| After a backup "full replace", a retry answers a deleted id as "saved"   | The idempotency retry key is still there                           | On a replace restore, also reset the retry keys in the same transaction                                              |
| A DB test looked "passed" but was not actually run                       | Skipped when `TEST_DATABASE_URL` is not set                        | Check the skip count and report the tests not run separately                                                         |

## 14. Source files to consult (workout-memo)

When you copy the settings as they are, compare against the files below as the source.

- Instructions: `AGENTS.md`, `skills/workout-implementation/SKILL.md`, `skills/workout-testing/SKILL.md`, `skills/workout-foundation/SKILL.md`, `skills/workout-foundation/references/stack.md`
- Settings: `package.json`, `.npmrc`, `.editorconfig`, `.gitattributes`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, `frontend/tsconfig.json`, `backend/tsconfig*.json`, `frontend/vite.config.ts`
- Run: `compose.yaml`, `.env.example`, `frontend/Dockerfile`, `frontend/nginx.conf`, `backend/Dockerfile`
- CI: `.github/workflows/ci.yml`, `frontend|backend|infrastructure/.github/workflows/ci.yml`
- Repositories: `scripts/create-repositories.ps1`, `scripts/push-repositories.ps1`, `scripts/backup.ps1`, `scripts/claude-skills.mjs`
- Infrastructure: `infrastructure/main.tf`, `infrastructure/versions.tf`, `infrastructure/README.md`
- Docs: `docs/development-baseline.md`, `docs/project-github-auth.md`, `docs/local-agent-workflow.md`, `docs/shared-hosting-costs.md`, `docs/agent-issue-template.md`
