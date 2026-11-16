# Require the shared sign-in (#149)

Issue: [#149](https://github.com/sirloinbh/money-ledger/issues/149). Pilot: workout-memo#303 (sirloinbh/project-standards ADR-0015, #550, #551).

## Purpose

The app had no login and relied only on the IP allow list. The shared sign-in is live, so every `/api` route except `/api/health` now needs a session from `sirloinbh/shared-auth`.

## Changes

- `backend/src/app.ts`: `createApp` takes an `auth` middleware and mounts it on `/api` after the rate limit and before any route (the CSV import router, the JSON parser, and every feature router). `/api/health` stays open (the middleware's `publicPaths`). New `GET /api/me` returns the signed-in user.
- `backend/src/server.ts`: passes `sharedAuth()` (the managed `standard/auth.ts`), which builds the middleware when `AUTH_INTERNAL_URL` is set and refuses to start in production without it.
- `compose.yaml`: the API joins the external `shared-auth` network and checks sessions at `http://shared-auth-api:3110`.
- `.env.example`: a commented `AUTH_INTERNAL_URL` line.
- `frontend/src/app.tsx`: the app content (`Workspace`) is wrapped in `SignInGate`, and the top bar shows `AccountActions`. The once-per-open calls (`saveTodayOnce`, `addDueOnce`) moved into `Workspace` so they run after sign-in, not as 401s before it. On localhost and IP addresses `SignInGate` renders its children directly, so nothing changes there.
- `backend/test/sign-in.test.ts`: 401 without or with a bad session on every route family, `/api/health` open, `/api/me` and a feature route answer with a session.

## Not changed

- This repo has no `backend/src/openapi.ts`, `docs/openapi.json`, or API reference document, so there is no `/api/me` row or status text to add.

## Verification

- Local: format, lint and typecheck pass; backend `sign-in` and `health` tests (7 pass); frontend `app` and `auth-origin` tests (15 pass); `node .standards/check.mjs` passes. The tests that need PostgreSQL and the rest of the frontend run in CI.
- `npm install --ignore-scripts` (user step) and `node .standards/lockfiles.mjs --write` updated the lockfiles for `@sirloinbh/auth-client` 1.0.0.
