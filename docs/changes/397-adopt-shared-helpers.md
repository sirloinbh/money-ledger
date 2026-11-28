# #397 Adopt the shared design-system helpers

Part of sirloinbh/project-standards#1177.

## Change

| Local copy (removed)                                 | Shared helper now used                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `serviceToday` in `format.ts`                        | `serviceToday` from `lib/format`                                        |
| `countOf` in `format.ts`                             | `plural` from `lib/format`                                              |
| `shiftDays`, `weekStart`, `dayLabel` in `day-nav.ts` | `addDays`, `weekStart`, `dayLabel` from `components/period-nav/periods` |

`readDay` and `weekdayName` stay in `day-nav.ts` (they are this app's address and label rules).

## Not changed

- `ChartBoundary` (lazy chart loading with its own reload), `BackupSection` (restore only into an empty database), the tables and the empty states stay local for now. They need a screen-level change and are left for a separate card.
- `dayLabel` in `net-worth.ts` is the medium style ("Nov 10, 2026"), a different format from the kit's day label, so it is not a copy.

## Visible differences

None: the removed helpers produced the same text.

## Verification

See the PR.
