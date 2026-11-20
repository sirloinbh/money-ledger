# project-standards#898: listen on the managed listenHost()

## Purpose

`server.ts` passed `'0.0.0.0'` to `listen`, so a local run without the shared sign-in was open to the network. The
managed `listenHost()` (project-standards#866) listens on `127.0.0.1` when the sign-in is off and on every interface
when it is on.

## Changes

| File                    | Change                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `backend/src/server.ts` | `const auth = sharedAuth()`, then `.listen(port, listenHost(auth !== undefined), …)` |

## Verification

- `eslint`, `prettier --check`, backend `tsc -p tsconfig.check.json`: pass.
- Production sets `AUTH_INTERNAL_URL`, so the container still listens on `0.0.0.0` and nginx still reaches it. After the deploy: the public `/api/health` answers 200.

## Limits

- `HOST` overrides the address if a setup needs another one.
