# Keep keyboard focus after selling out a mock holding (#279)

## Problem

Selling every share of a holding from its own order form removes the holding's row and the open form when the holdings reload. Nothing took the focus, so it fell to the page body and a keyboard or screen reader user restarted from the top of the page. The "Sold all your …" status was announced, but the place on the page was lost.

## Change

- `frontend/src/mock-holdings.tsx`: the "Holdings and returns" heading is now focusable (`tabIndex={-1}`, `outline-none`, as the headings in `assets.tsx` and `asset-trades.tsx`). When a reload finds the holding with the open form gone, the component sets a `soldOut` flag and an effect moves the focus to the heading after the new list has rendered.
- `frontend/src/mock-holdings.test.tsx`: the sell-out test now checks that the heading has the focus.

## Verification

- `mock-holdings.test.tsx` and `npm run check`: results are in the PR.
- Browser check at 390x844 and 1440x900: results are in the PR.
