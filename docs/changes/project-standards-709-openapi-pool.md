# Adopt the managed OpenAPI builder and createPool (project-standards#709, part 2)

- `openapi.ts` is only the operation table plus `buildOpenApi(...)` from the managed `standard/openapi.ts` (`z.toJSONSchema`); the hand-written Zod walker is gone.
- The route discovery (sub-routers mounted with `app.use`) moved into `test/openapi.test.ts`, which checks the table against the registered routes.
- `openapi-cli.ts` is the one-line entry to the managed CLI.
- `src/pool.ts` is removed: `server.ts` uses the managed `createPool(new Pool(...))`, which now also listens on checked-out clients.
- `docs/openapi.json` is regenerated: it gains the shared sign-in security scheme and the default 401, 413 and 429 responses.
- Verification: typecheck, eslint, prettier, non-DB tests (202 pass). DB tests run in CI.
- The month path parameter (`:month`, YYYY-MM) is declared with `params`.
