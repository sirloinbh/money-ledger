# Checked int8 parser; no id conversions (project-standards#779)

- `app.ts` calls `setInt8Parser(types)`: BIGINT ids come back as numbers and throw above 2^53.
- Removed `Number(row.id)`-style conversions and the `id::text` casts (including `*_id`). Row types use `number` for ids.
- Kept: `amount::text` and other money casts, and `id::text AS key` in `allocation.ts` (that column is a text key shared with asset-type keys such as `stock`).
- API output does not change.
- Verification: backend typecheck, eslint on `backend`, prettier. Integration tests need Postgres and run in CI.
