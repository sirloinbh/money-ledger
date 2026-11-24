# Fill the KRX holiday calendar from a real source (#321)

Found while building #310: `krx_holidays` was a hand-kept table with three seeded days. Stacked on #310.

## Changes

| File                                           | Change                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/price-source.md`                         | New section "KRX holidays (#321)": the three sources compared and the choice                                                                              |
| `backend/src/prices/kis.ts`, `kis-fake.ts`     | Optional `calendar(from)` on `KisSource` (KIS 국내휴장일조회), `parseCalendar`; the fake answers weekdays as open. A small additive edit in lane-1's file |
| `backend/src/prices/krx-calendar.ts`           | `isBusinessDay` (moved here from `long-hold.ts`), `ruleClosures`, `syncHolidays`, the daily `krx-holidays` queue                                          |
| `database/migrations/047_krx_holiday_sync.sql` | `krx_holidays.source` (`manual`, `rule`, `kis`) and the one-row `krx_holiday_sync`                                                                        |
| `backend/src/mock/long-hold.ts`, `server.ts`   | #310 now uses the shared function; the queue is added and sent once at start                                                                              |

## Rules

- Source: KIS `chk-holiday`, which needs no new key (the #305 key). The public-data special-day API lacks Labour Day and the year-end closing day, so it is the backup, not the choice.
- Two KRX-only closures are computed (Labour Day on a weekday, last weekday of December) so they hold even before #304.
- KIS is read when the last read is older than 25 days, from today to the end of next year. A failed or empty read changes nothing. `manual` and `rule` rows are never changed.

## Choices made without asking

- **KIS over the public data portal**: one key, includes KRX-only closures, and it is the exchange's own flag. Say so if you want the data.go.kr API instead.
- **Migration number 047**, the next free number above everything on main (046 is the keep-or-sell questions table). It adds `source` to the table that 046 creates.
- The seeded rows from 042 stay as `manual` rows.

## Checks

- Unit: `krx-calendar.test.ts` (a recorded-shape answer, unreadable rows, the rules for 2026, 2027 and a year where Dec 31 is a Sunday).
- DB integration, none skipped: `krx-calendar.integration.test.ts` (fill from KIS and the rules while keeping a manual row; skipping while fresh and replacing only `kis` rows in the range read; a failed or empty read changing nothing and leaving the sync unmarked; no source adds rules only; `isBusinessDay` for a holiday, a manual row, a weekend and a normal day). The #310 fake-clock tests pass with the shared function.
- The KIS endpoint and field names are secondary (not read from a real account): waiting on #304.
