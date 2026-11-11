---
paths:
  - "database/**"
  - "backend/**"
---

<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/.claude/rules/에서 -->

# Database and DB tests

- Migrations live only in `database/migrations` and must be safe to run again. Apply them as [database/README.md](../../database/README.md) says.
- DB integration tests: set `TEST_DATABASE_URL` to a dedicated test DB with the schema ready, then run `npm test`. Without it the integration tests are skipped, so do not report the DB as verified.
