# #189 Stop older asset list responses overwriting newer ones

- Issue: [#189](https://github.com/sirloinbh/money-ledger/issues/189)
- Branch: `fix/189-asset-list-ordering`
- Parent: #208 Fast and maintainable asset and entry screens

## Purpose

On the asset screen, `load` ran from the first render, from each save's reload and from a voucher use (`onUsagesChanged`) with no sequencing, so an older response that arrived last put stale rows and totals back. `remove` checked `saving.current` but never set it, so a submit could run during a delete. `depreciationBody` checked the purchase date with a regex and a range, so `2026-02-30` passed, while the other paths use `realDate`.

## Changes

- `frontend/src/assets.tsx`:
  - `load` numbers its requests (`latestLoad` ref) and applies an answer, or reports a failure, only if no newer load started after it.
  - `remove` sets and clears `saving.current` and the busy state around the delete and its reload, like `submit`.
  - `depreciationBody` checks the purchase date with `realDate` (a real calendar date between 1900 and 2100). An empty date still says "Enter the purchase date".

## Verification

- `frontend/src/assets.test.tsx`:
  - "a purchase date that is not on the calendar is not sent": with the date input as a text box (a browser without a date picker), `2026-02-30` is refused before sending and the field is marked.
  - "an older list answer that arrives last does not replace a newer one": the first load is held back, a save's reload answers with the new asset, then the old answer arrives and is ignored; totals stay ₩305,000,000.
  - "a save waits while a delete is running": while a held DELETE runs, a form submit sends nothing; after the delete it goes through.
- All three fail without the `assets.tsx` change and pass with it.
- No browser check at 390×844 and 1440×900: nothing in the layout changed, and the only visible change is the submit button reading "Saving…" while a delete runs. The machine was short on memory during this run (see the PR), so the dev servers were not started.
- Commands and results are in the PR body.

## Limits

- None known.
