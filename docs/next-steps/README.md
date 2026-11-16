# Next steps

Last updated: **2026-11-17 (Asia/Seoul)**.

## Priority

| Order | Task                                                    | Status             | Next action                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Automatic spending classification (#60)                 | Done               | Keyword rules and bulk classification merged (PR #84)                                                                                                                                                       |
| 2     | Decide the price source (#36)                           | Done               | [Price and exchange rate sources](../price-source.md). Applies to current price update (#47) and quotes (#51)                                                                                               |
| 3     | Get price and exchange rate API keys (#85)              | User step          | Sign up at KRX, Tiingo, and Korea Eximbank and store the keys in AWS SSM (`/sirloinbh/money-ledger/*-api-key`). `node tools/app-secrets.mjs pull money-ledger` in project-standards writes them into `.env` |
| 4     | Fixed costs (#43)                                       | Done               | Merged as PR #144 ([record](../changes/43-fixed-costs.md))                                                                                                                                                  |
| 5     | Entries as CSV (#44)                                    | Done               | Merged as PR #145 ([record](../changes/44-entry-csv.md))                                                                                                                                                    |
| 6     | Summary dashboard (#55)                                 | Done               | Merged as PR #146 ([record](../changes/55-summary-dashboard.md))                                                                                                                                            |
| 7     | Reserve the name "Uncategorized" (#110)                 | Done               | Merged as PR #147 ([record](../changes/110-reserve-uncategorized.md))                                                                                                                                       |
| 8     | Read-only security detail and tracking limit (#98)      | Done               | Merged as PR #148 ([record](../changes/98-read-only-security-detail.md))                                                                                                                                    |
| 9     | Overspending review (#61)                               | Done               | Merged as PR #150 ([record](../changes/61-overspending-review.md))                                                                                                                                          |
| 10    | Weekly and monthly spending reports (#62)               | Done               | Merged as PR #151 ([record](../changes/62-spending-reports.md))                                                                                                                                             |
| 11    | Apply migrations on deploy (#71)                        | Done               | Merged as PR #153 ([record](../changes/71-migrate-on-deploy.md))                                                                                                                                            |
| 12    | AI classification research (#83)                        | Done               | Merged as PR #155 ([doc](../ai-classification.md)): history first, AI later                                                                                                                                 |
| 13    | Suggestions from past classifications (#154)            | In progress        | Branch `feat/154-merchant-suggestions` ([record](../changes/154-merchant-suggestions.md)): PR, review, merge                                                                                                |
| 14    | Import research for card, bank, Coupang, KakaoPay (#56) | User step          | Send one sample export per source with personal details removed (not committed); then the comparison and decision go in `docs/`                                                                             |
| 15    | Rename the installable app to the new name              | Waiting on central | Merge the `project-standards#399` sync PR                                                                                                                                                                   |

## Development environment follow-ups (deferred)

These are the problems left from the 2026-11-02 setup. The causes and recovery commands are in the [#32 change record](../changes/32-dev-env-followups.md).

| Order | Task                                                 | Status              | Next action                                                                        |
| ----- | ---------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| 1     | Turn on BIOS virtualization and start Docker Desktop | User step           | Turn on SVM Mode, run `wsl --install --no-distribution`, then reboot               |
| 2     | Create `.env`                                        | User step           | Copy `.env.example` and change the password                                        |
| 3     | Prepare the dedicated test DB `money_test`           | Waiting on 1 and 2  | Create the DB, then set `TEST_DATABASE_URL` only in the terminal and verify        |
| 4     | Fix the port error handling in `server.ts`           | No issue registered | In a new issue, add error handling for the `listen` callback and a regression test |
| 5     | Clean up local `main` and past branches              | User approval       | Run the commands in the change record or approve the agent doing it                |
| 6     | Decide the TCP dynamic port range                    | User decision       | Decide whether to exclude the app ports or restore the range                       |

## Execution boundaries

Deployment, sub-repository sync, and AWS resource creation happen only on a separate request. Add the ECR repositories of the shared infrastructure to the list in `shared-aws-infrastructure` at the first deployment.
