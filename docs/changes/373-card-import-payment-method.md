# Imported card payments count in the card deduction estimate (#373)

## Problem

`card-import.ts` inserted entries without `payment_method`. The card deduction estimate (#296) leaves entries without a payment method out and shows them as "unknown", so imported card spending, the main source of it, was not counted until each entry was edited by hand.

## Change

- The import query takes `paymentMethod` (`credit_card` by default, or `debit_card`). New entries get it.
- An update row leaves `payment_method` alone, so a method the person changed afterwards survives a newer file.
- The import card on the Ledger page has a "Card type" choice (credit card, debit card).
- Entries imported before this change stay "unknown"; the person can edit them.

## Tests

`card-import.integration.test.ts`: the default and the chosen method on new entries; an edited method kept on update; `cash` refused with 422. `card-import.test.tsx`: the request URLs carry the method.
