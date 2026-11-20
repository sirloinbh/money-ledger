# Adopt the shared db and rate-limit modules (project-standards#709, part 1)

- `inTransaction` (db.ts) is a typed one-liner over the managed `withTransaction`; BEGIN/COMMIT/ROLLBACK are no longer written here.
- `src/pool.ts` (`connectPool`): the managed `createPool` plus a per-connection `error` listener (pg stops listening on a checked-out client). `server.ts` uses it.
- `app.ts` uses the managed `apiRateLimit(app)`: per client IP (the last X-Forwarded-For entry, which nginx appends), 600 per minute, health not counted, the managed 429 text.
- Not in this PR: the OpenAPI builder (needs typed path params in the managed builder).
- Verification: typecheck, eslint, prettier, non-DB tests. DB tests run in CI.
