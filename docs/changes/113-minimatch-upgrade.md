# #113 Upgrade the dev dependency minimatch to 11.0.1 or later

- Issue: [#113](https://github.com/sirloinbh/money-ledger/issues/113)
- Branch: `chore/113-minimatch-upgrade`
- Parent: #81 Deployment and code structure cleanup

## Purpose

Dependabot alert #8 (moderate, denial of service through globparts expansion) covers minimatch `>= 7.0.0, < 11.0.1`. The lockfile had `node_modules/minimatch` at 10.2.6, a dev-only dependency that is not in the server bundle.

## Who pulls minimatch (`npm ls minimatch --all` before the change)

| Path                                                                   | Range     | Version | In the alert range |
| ---------------------------------------------------------------------- | --------- | ------- | ------------------ |
| `eslint@10.12.0`, `@eslint/config-array@0.23.5`                        | `^10.x`   | 10.2.6  | yes                |
| `typescript-eslint@8.71.2` → `@typescript-eslint/typescript-estree`    | `^10.x`   | 10.2.6  | yes                |
| `eslint-plugin-jsx-a11y-x@0.2.0`                                       | `^10.2.5` | 10.2.6  | yes                |
| `@lhci/cli` → `lighthouse` → `@sentry/bundler-plugins` → `glob@14.0.6` | `^11`     | 11.0.9  | no (patched)       |
| `@lhci/cli` → `chrome-launcher@0.13.4` → `rimraf@3.0.2` → `glob@7.2.3` | `^3.1.1`  | 3.1.5   | no (below 7.0.0)   |

## Choice

- Upgrading the parents is not enough: `eslint-plugin-jsx-a11y-x` 0.2.0 is the latest release and still asks for `^10.2.5`. The newer `eslint` (10.15.0) and `typescript-eslint` (8.73.0) accept 11, but their versions are centrally managed `package.json` fields (`.standards/manifest.json`), so bumping them belongs to `sirloinbh/project-standards`.
- So the root `package.json` gets a range-scoped override (the `overrides` field is not centrally managed):

  ```json
  "overrides": { "minimatch@>=7.0.0 <11.0.1": "11.0.9" }
  ```

  It replaces only copies inside the alert range. It does not touch the minimatch 3.1.5 under `rimraf@3` / `glob@7`: that line is outside the alert, and minimatch 11 has no callable default export, so forcing it there would break `glob@7` (used by `@lhci/cli`'s `chrome-launcher`). `@lhci/cli` 0.16.1 is already the latest release and still pins `chrome-launcher@^0.13.4`.

- After the change every minimatch in the alert's major range is the deduplicated 11.0.9; the lockfile loses the nested `glob/node_modules/minimatch` copy. `npm audit` reports 0 vulnerabilities.
- When the central standards later bump `eslint` and `typescript-eslint`, only `eslint-plugin-jsx-a11y-x` still needs the override; it can be dropped once that plugin accepts minimatch 11.

## Verification

- `npm install --ignore-scripts`: done; `npm ls --all` exits 0 (no invalid or missing packages); `npm ls minimatch --all` shows `11.0.9 overridden` under `eslint-plugin-jsx-a11y-x` and `11.0.9 deduped` under `eslint`, `@eslint/config-array` and `@typescript-eslint/typescript-estree`.
- `npm audit`: found 0 vulnerabilities.
- `npm run check` (`TEST_DATABASE_URL` on the agent1 test DB): pass. Format, lint (`--max-warnings 0`), contract check, typecheck, backend 461 pass and 0 skipped, frontend 550 passed and 3 skipped (managed `skipIf` tests), skills 4 pass, build pass.
- `npm run knip`: pass (only the existing configuration hints).
- `npm run standards:check`: pass.
- ESLint with minimatch 11 still matches globs: a probe file under `.standards/` is reported as ignored by the config's `ignores` pattern, and a probe `<img src="x" />` in `frontend/src` fails `jsx-a11y-x/alt-text`. Both probe files were deleted.
- `npm run test:e2e` was not run: Playwright and the app do not use minimatch.

## Limits

- `rimraf@3` / `glob@7` keep minimatch 3.1.5 (not affected by alert #8). The issue's "every minimatch entry is 11.0.1 or later" is read as every entry in the alert range; making 3.1.5 go away needs `@lhci/cli` to drop `chrome-launcher@0.13`.
