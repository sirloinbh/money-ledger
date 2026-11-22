# #181: correct OpenAPI status codes and include every route

Issue: https://github.com/sirloinbh/money-ledger/issues/181 (parent #206)

## Purpose

`docs/openapi.json` should list the status codes the handlers really answer and include `GET /api/jobs/status`.

## Changes

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/openapi.ts`       | Adds `GET /api/jobs/status` (200; 503 when jobs are off, starting, or failed, #178). Every guarded operation gets 503 (sign-in service down). `PATCH /api/ledger/fixed-costs/:id` gets 422, `GET …/orders/preview` gets 409, `GET /api/health` gets 429 (the rate limit runs before it). The CSV export's 200 is `text/csv`. The month path pattern was `^d{4}-…` (a missing backslash, so only a literal `dddd` matched); it is now `^\d{4}-…`. |
| `backend/test/openapi.test.ts` | The route walk builds the app with a stub `jobsStatus`, as `server.ts` always passes one, so the jobs route is compared like any other. New tests below.                                                                                                                                                                                                                                                                                         |
| `docs/openapi.json`            | Regenerated with `npm run openapi -w backend` (44 paths).                                                                                                                                                                                                                                                                                                                                                                                        |

How the lists were checked: every `HttpError(...)`, `res.status(...)` and pg error mapping in the routers
(`backend/src/*.ts`, `prices/router.ts`) was compared with the table. Only the routes above had drifted; `parseId`
(400), the body parse (400) and the other mapped errors were already listed.

The issue's CLI task no longer applies as written: the managed `standard/openapi-cli.ts` writes the document from the
operation table and never builds the app, so only the test needed the stub handler.

Not done here (as the issue notes): response schemas and the converter stay with project-standards (architecture M9).

## Verification

- `backend/test/openapi.test.ts` (8 tests, pass): the committed `docs/openapi.json` matches the table; the table and
  the registered routes (now including `GET /api/jobs/status`) are the same set; every guarded operation lists 401, 429
  and 503 and the health check lists 429 without 503; `PATCH fixed-costs/{id}` lists 422, `orders/preview` lists 409,
  `jobs/status` lists exactly 200/401/429/503, the CSV export's 200 is `text/csv`; the month pattern accepts `2026-11`
  and rejects `dddd-11` and `2026-13`.
- `TEST_DATABASE_URL=<agent3 test DB> npm run check` (through the shared check lock): exit 0. Backend 425 pass / 0
  skipped, frontend 463 pass / 3 skipped, skills 4 pass, build ok. `npm run knip`: exit 0.
