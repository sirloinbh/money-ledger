# #179: align compose.yaml with the deploy contract

Issue: https://github.com/sirloinbh/money-ledger/issues/179 (parent #206)

## Purpose

The synced `deploy/remote-deploy.sh` requires image tags from `${IMAGE_TAG}` and the web port from
`${WEB_BIND}:${WEB_PORT}`, so a deploy can roll back by tag.

## What was already done

PR #212 (#211) already changed `compose.yaml`: `image: money-backend:${IMAGE_TAG:-local}`,
`image: money-frontend:${IMAGE_TAG:-local}`, and `ports: ['${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8105}:80']`. This
change does only the missing part of #179: the notes.

## Changes

| File                    | Change                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`          | Commented `IMAGE_TAG`, `WEB_BIND`, `WEB_PORT` with their local defaults and who sets them on the server.                         |
| `docs/project-setup.md` | 5.7: a "deploy contract" paragraph, and the example `compose.yaml` now has the `image:` lines and the variable web port binding. |

## Verification

- `docker compose --env-file .env.example config` (nothing set): `image: money-backend:local`,
  `image: money-frontend:local`, web port `host_ip: 127.0.0.1`, `published: "8105"`, `target: 80`.
- `IMAGE_TAG=abc123 WEB_BIND=0.0.0.0 WEB_PORT=9105 docker compose --env-file .env.example config`:
  `money-backend:abc123`, `money-frontend:abc123`, web `host_ip: 0.0.0.0`, `published: "9105"`.
- Docs only, so no app tests were added. `TEST_DATABASE_URL=<agent3 test DB> npm run check`: exit 0 (backend 412 pass /
  0 skipped, frontend 463 pass / 3 skipped, skills 4 pass, build ok). `npm run knip`: exit 0.

## Limits

- A local `docker compose up` on 127.0.0.1:8105 was not run: this worker may not bind 8105 (the user's own app port),
  and the image build needs `NODE_AUTH_TOKEN`. The compose output above shows the same default binding, and CI's
  `docker-build` job builds both images.
