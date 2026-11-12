# #3 Change the ports to the central standard (slot 05) and split out AGENTS project-specific rules

- Issue: https://github.com/sirloinbh/money-ledger/issues/3
- Central tracking issue: https://github.com/sirloinbh/project-standards/issues/99

## Purpose

- Apply the ports that the central registry reassigned so that the ports of the 8 apps do not overlap (project-standards ADR-0006).
- Before the first central standards sync turns AGENTS.md into the shared instructions, move this project's PR review and merge rules into AGENTS.project.md to preserve them.

## Changes

| Kind                       | Before | After     |
| -------------------------- | ------ | --------- |
| Web                        | 8095   | 8105      |
| API                        | 3015   | 3105      |
| Vite                       | 5175   | 5205      |
| Host DB                    | 55445  | 15405     |
| e2e API and web (reserved) | none   | 3205·5305 |

- Files where ports changed: `.env.example`, `README.md`, `backend/Dockerfile`, `backend/src/server.ts`, `compose.yaml`, `frontend/nginx.conf`, `frontend/vite.config.ts`, `AGENTS.md`
- Moved step 5 of the procedure in `AGENTS.md` (automatic code review and merge rules), word for word, into "Work procedure" in `AGENTS.project.md`, and made `AGENTS.md` require reading that file.
- We did not edit the past records in `docs/changes/`, `docs/daily/`, and `docs/next-steps/`, because they describe the state at the time.

## What the user does

- Change the port in `DATABASE_URL` in the local `.env` from `55445` to `15405`, and `PORT` from `3015` to `3105`. Do not commit `.env`.

## Verification

- 2026-10-22: the result is written in the PR body.
