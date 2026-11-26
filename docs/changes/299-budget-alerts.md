# Budget overrun alerts by KakaoTalk (#299)

A category whose spending reaches or passes its monthly budget now sends one KakaoTalk "send to me" message (user decision on #299, 2026-11-26). The send goes through the existing notifier, so it runs against the fake sender in tests. Real sends start when the Kakao keys from #304 are in place (a user step).

| File                                             | Change                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/056_budget_alerts_sent.sql` | New `budget_alerts_sent (category_id, month)` table: the claim that keeps it to one alert per budget per month                                                                                            |
| `backend/src/ledger/budget-alert.ts`             | `sendBudgetAlerts` reads the month's budgets with the budget page's own SQL, claims each `reached` or `over` category, then notifies. `budgetAlertQueue` runs it every 30 minutes, 08:00-22:30 Asia/Seoul |
| `backend/src/kakao/messages.ts`, `notifier.ts`   | Append-only: a `budget-alert` event and its message; the other events are unchanged                                                                                                                       |
| `backend/src/server.ts`                          | One queue line                                                                                                                                                                                            |
| `backend/src/backup.ts`                          | One line: `budget_alerts_sent` joins the entered tables (the schema-driven backup test requires every table to be classified)                                                                             |
| `backend/test/budget-alert.integration.test.ts`  | Below budget sends nothing; reached and over; once per month even if spending grows; months and categories apart; not connected claims nothing; concurrent runs send one; the queue handler               |

## Rules

- "Crossed" is the app's overspending line (#61): spending equal to the budget counts (`reached`), above it is `over`.
- At most one alert per budget per month. Raising the budget afterwards does not alert again that month. A failed send is logged by the notifier and not retried (the claim stays), so a broken connection cannot repeat alerts.
- Not connected: nothing is claimed, so the alert goes out after KakaoTalk is connected.
- Category budgets only: the schema has no total monthly budget.

## Verification

`npm run check` (lane DB, 0 skipped): format, lint, contract, typecheck, 728 backend tests, 4 skills tests, build all pass. `npm run knip`: no findings from this change (3 existing config hints).

## User steps

- Real sends need the Kakao keys from #304.
