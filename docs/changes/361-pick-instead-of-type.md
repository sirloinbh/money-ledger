# #361 Pick values instead of typing them in forms

- Issue: https://github.com/sirloinbh/money-ledger/issues/361
- Branch: feat/361-pickers

## Audit of every input in `frontend/src`

| Field                                                                                                                                    | Kind           | Result                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| Category (entries, rules, filters, CSV import), entry kind, asset type, currency, account and card selects, repeat and frequency choices | Known sets     | Already select or radio                                                                               |
| Dates, months, day of month                                                                                                              | Dates          | Already date and month inputs                                                                         |
| Amounts, quantities, prices, rates, fees, tax                                                                                            | Numbers        | Number inputs (typing is the right input)                                                             |
| Merchant (entry form)                                                                                                                    | Repeating text | **Changed**: Combobox offering the merchants of the listed entries; a new merchant can still be typed |
| Entry note, asset name and memo, trade memo, goal name, fixed-cost name, category name, rule keyword, search                             | Open text      | Stay free text                                                                                        |

## Verification

`npm run check`.
