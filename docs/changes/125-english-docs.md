# Translate the current Korean docs to English (#125)

Issue: [#125](https://github.com/sirloinbh/money-ledger/issues/125), tracked by [project-standards#487](https://github.com/sirloinbh/project-standards/issues/487).

## Purpose

Every markdown file outside `docs/changes/`, `docs/daily/`, and `docs/adr/` is English. Past records are handled in #124, and code comments in #123.

## Changes

- Translated `README.md`, `backend/README.md`, `frontend/README.md`, `database/README.md`, `AGENTS.project.md`, `docs/next-steps/README.md`, `docs/price-source.md`, and `docs/project-setup.md`.
- Translated the three project skills in `skills/` and refreshed the copies in `.claude/skills/` with `npm run skills:sync`.
- Skipped centrally managed files (listed in `.standards/manifest.json` or marked as managed).
- Commands, paths, identifiers, issue and PR numbers, dates, and code blocks are unchanged. The heading anchor `#11-bootstrap-checklist` in `docs/project-setup.md` was updated with its heading.

## Korean kept on purpose

- `docs/project-setup.md`: the example app display name `FORM · 나의 운동 기록` and the example string `'기타'` (they are sample data from the source app, workout-memo).

## Verification

- `prettier --check` on the changed files: pass.
- `npm run test:skills`: pass (the `.claude/skills/` copies match `skills/`).
- Hangul search over the markdown files in scope (excluding `docs/changes/`, `docs/daily/`, and managed files): only the two examples above remain.
