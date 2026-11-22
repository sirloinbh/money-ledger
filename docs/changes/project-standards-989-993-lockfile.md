# Lockfile for design-tokens 1.1.0 and @lhci/cli 0.16.1 (central sync)

- Sync PR: #233 (branch `chore/standards-sync-10a6d06`)
- Central work: sirloinbh/project-standards#989 (design-tokens 1.1.0, Pretendard dynamic subset), #993 (`@lhci/cli` 0.16.1 for the `proxy-agent` 8 / `basic-ftp` security fix)

## Problem

The sync commit raised `@sirloinbh/design-tokens` to 1.1.0 in `frontend/package.json` and `@lhci/cli` to 0.16.1 in `package.json`, but `package-lock.json` still pinned the old versions, so `npm ci` failed in CI.

## Change

The user ran `npm install --ignore-scripts --engine-strict=false --no-audit --no-fund` on this branch on 2026-11-22 (GitHub Packages needs the user's token, project-standards `docs/user-steps.md` section 12). Only `package-lock.json` changed.

- The only production change is `@sirloinbh/design-tokens` 1.0.0 → 1.1.0 (0 dependencies). Same font family and weights; a page now downloads only the font chunks its text needs (health-log measured -96.9% font bytes on a cold first load).
- Every other changed entry is dev-only and belongs to the `@lhci/cli` 0.16.1 tree. The root entry changes only the `@lhci/cli` pin, and the `frontend` workspace entry only the design-tokens pin.
- New package names: `proxy-agent-negotiate`, `quickjs-wasi`; removed: `@tootallnate/quickjs-emscripten`.

Versions under the 14-day rule ([dependency policy](https://github.com/sirloinbh/project-standards/blob/main/docs/dependency-policy.md)), **accepted by the user on 2026-11-22 for the #993 security fix** (the same set accepted for health-log#315):

| Package                            | Version | Published (UTC) |
| ---------------------------------- | ------- | --------------- |
| `@lhci/cli`                        | 0.16.1  | 2026-11-11      |
| `@lhci/utils`                      | 0.16.1  | 2026-11-11      |
| `quickjs-wasi`                     | 3.7.0   | 2026-11-13      |
| `degenerator`                      | 7.0.2   | 2026-11-16      |
| `get-uri`                          | 8.0.2   | 2026-11-16      |
| `pac-proxy-agent`                  | 9.1.1   | 2026-11-16      |
| `pac-resolver`                     | 9.0.2   | 2026-11-16      |
| `proxy-agent`                      | 8.0.3   | 2026-11-16      |
| `sentry`                           | 0.50.0  | 2026-11-18      |
| `@sentry/conventions`              | 0.34.0  | 2026-11-19      |
| `socks`                            | 2.8.11  | 2026-11-19      |
| `tldts-core`                       | 7.5.5   | 2026-11-19      |
| `tldts-icann`                      | 7.5.5   | 2026-11-19      |
| `@sentry/bundler-plugins`          | 11.16.0 | 2026-11-20      |
| `@sentry/core`                     | 11.16.0 | 2026-11-20      |
| `@sentry/node`                     | 11.16.0 | 2026-11-20      |
| `@sentry/opentelemetry`            | 11.16.0 | 2026-11-20      |
| `@sentry/server-runtime-injection` | 11.16.0 | 2026-11-20      |
| `@sentry/server-utils`             | 11.16.0 | 2026-11-20      |
| `netmask`                          | 2.1.2   | 2026-11-20      |
| `robots-parser`                    | 3.1.1   | 2026-11-21      |

## Verification

- Lockfile diff checked entry by entry (old vs new `packages`): production change is design-tokens only, as listed above.
- CI on this PR runs `npm ci`, the full check and the dependency scan.
