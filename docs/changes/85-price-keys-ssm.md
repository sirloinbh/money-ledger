# Read the price and exchange rate API keys from AWS SSM (#85)

## Purpose

The KRX, Tiingo, and Korea Eximbank keys (#36, `docs/price-source.md`) were planned as manual `.env` values. project-standards ADR-0014 keeps external service keys in AWS SSM, so the PC and the server read them from one place.

## Changes

- `.env.example`: tagged `KRX_API_KEY`, `TIINGO_API_KEY`, and `KOREAEXIM_API_KEY` with `@secret @used=backend @ssm=/sirloinbh/money-ledger/<name>` (`krx-api-key`, `tiingo-api-key`, `koreaexim-api-key`, the paths proposed in the #85 comment).
- `docs/next-steps/README.md`: the #85 row says where the keys go.

## Keys

- The user signs up on the three sites and stores each key with `node tools/app-secrets.mjs set /sirloinbh/money-ledger/<name>` in project-standards. Values are never written in this repository, issues, or PRs.
- PC: `node tools/app-secrets.mjs pull money-ledger` writes them into `.env`. Server: `deploy/remote-deploy.sh` reads the tagged keys on each deploy.
- Renewal: KRX every year (request an extension), Korea Eximbank every 2 years (re-consent by email), Tiingo none.

## Verification

- `appKeys('money-ledger', ...)` from project-standards `tools/app-secrets.mjs` returns the three keys and their parameters (the tags pass the ADR-0014 rules).
