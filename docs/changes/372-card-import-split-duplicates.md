# Card import with split entries and repeated approval numbers (#372)

## Problem

- Re-importing a file that changed the amount of a payment the person had split into parts (#292) failed at commit: the deferred trigger `ledger_entries_splits_sum` refuses an amount that no longer equals its parts. The whole import returned a 500.
- A file that repeated a card and approval number planned both rows as new, and the second insert hit the unique index of migration 055: a 500 for the whole file.

## Change

- `plan()` marks an existing entry that has split parts with the action `split`. An update or a removal never touches it; it counts as left out (`skipped`) in the result, and the preview shows "Split by hand, left as it is".
- `read()` adds a problem for each later row with the same card and approval number as an earlier row. Preview lists them; import answers 422 and saves nothing (the rule that already applies to unreadable rows).
- `frontend/src/card-import.tsx`: a label for the new action.

## Tests

`backend/test/card-import.integration.test.ts`: a split entry beside an updated and a removed entry in one import; a file with a repeated approval number is refused by line, nothing saved.
