# Next steps

Last updated: **2026-11-06 (Asia/Seoul)**.

## Priority

| Order | Task                                       | Status             | Next action                                                                                                   |
| ----- | ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1     | Automatic spending classification (#60)    | Done               | Keyword rules and bulk classification merged (PR #84)                                                         |
| 2     | Decide the price source (#36)              | Done               | [Price and exchange rate sources](../price-source.md). Applies to current price update (#47) and quotes (#51) |
| 3     | Get price and exchange rate API keys (#85) | User step          | Get the KRX, Tiingo, and Korea Eximbank keys and put them in the local `.env`                                 |
| 4     | Remaining feature issues (#39 to #64)      | Registered         | Work through them in order of each issue's prerequisites and priority                                         |
| 5     | Rename the installable app to the new name | Waiting on central | Merge the `project-standards#399` sync PR                                                                     |

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
