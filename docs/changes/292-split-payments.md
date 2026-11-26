# Split one payment into several categories (#292)

An expense can be split into 2 to 10 parts, each with its own category and whole-won amount. The parts must add up to the payment exactly. Category totals, budgets and reports count the parts; the entry list shows them; the entry form has a split editor; undoing a split returns to one category.

## Design

- **Storage.** New table `ledger_entry_splits` (entry, position, category, amount). The entry keeps its own total (`ledger_entries.amount`). A split is only for expenses: the table's `kind = 'expense'` column and the composite foreign key to `ledger_categories (id, kind)` keep the category an expense category. Deleting an entry deletes its parts.
- **Sum rule.** The API checks the sum and answers with a message. A deferred constraint trigger checks it again at commit, so nothing that writes to the tables can leave parts that do not add up (also when an entry's amount is changed alone).
- **The entry's own category** is the category of its largest part (first on a tie). The classification list, merchant suggestions and rules read `category_id`, so a split entry is never "Uncategorized".
- **Totals.** The view `ledger_entry_parts` is each entry's splits, or the entry itself when it has none. The monthly summary by category, the budgets' spent amount and the report's top categories read it. Totals that do not group by category (income, expense, trend, balance) still read the entries: the sums are the same.
- **Entry list filter.** A category filter matches an entry when any part is in that category.
- **CSV (#44).** Export writes one row per part (the part's category and amount, the entry's date, merchant and note), so a file adds up per category. Importing it creates one entry per row. The CSV format did not change.
- **Edits.** `splits` in the entry body: omitted on a new entry means not split; omitted when editing a split entry is refused with a message (so the amount and category cannot drift from the parts); `null` or `[]` undoes the split and the entry keeps `categoryId`. Confirming a fixed cost whose entry was split answers 409: undo the split first.

## Changes

| File                                                                             | Change                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `database/migrations/051_entry_splits.sql`                                       | Table, view, sum trigger                                                                             |
| `backend/src/ledger/entry-splits.ts`                                             | Body rules, `checkParts`, `writeSplitEntry` (one transaction), `loadSplits`                          |
| `backend/src/ledger/entries.ts`                                                  | `splits` in the body and the answer, create and replace, the category filter                         |
| `summary.ts`, `budgets.ts`, `reports.ts`, `entry-csv.ts`, `fixed-costs.ts`       | Read the parts; CSV export per part; the fixed cost guard                                            |
| `frontend/src/entry-form.tsx`, `entry-model.ts`, `entries.tsx`, `entry-list.tsx` | The split editor, the parts check, the parts in the list                                             |
| tests                                                                            | `entry-splits.integration.test.ts`, `entry-splits.test.tsx`; existing entry tests list the new field |

## Verification

See the PR.

## Limits

Parts are per payment, not per item: item names from Coupang or KakaoPay (#58, #59) can fill parts later. Only expenses are split. A part's amount is at least ₩1.
