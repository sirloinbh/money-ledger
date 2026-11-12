# #41 Monthly income and expense trend chart

- Issue: https://github.com/sirloinbh/money-ledger/issues/41
- Branch: `feat/41-monthly-trend`

## Purpose

The one-month summary (#40) alone cannot tell whether spending is rising. See the change in income, expenses, and balance over the last several months in one chart.

## Decided during implementation

- Period: choose from 6, 12, or 24 months up to this month (Seoul time). The default is 12 months. The period stays in the address `?trend=6|24`, and 12 months is omitted from the address. It does not clear the summary's `month` or the entry filter values, and they do not clear it.
- The API period is at most 24 months. We did not open it wider than what the screen chooses.
- Months with no entries are filled with a row of 0 won (SQL `generate_series`), so the line does not break. If there are no entries in the whole period, we show "이 기간에는 내역이 없습니다." ("There are no entries in this period.") instead of a flat chart.
- Month boundary: `entry_date` is already a Seoul date (a `date` without a time zone). Months are split with `to_char(entry_date, 'YYYY-MM')`, so it does not depend on the DB session time zone. "This month" on the screen is decided by `serviceToday()` (Seoul).
- The balance is income − expense and is computed with SQL `numeric`. If there is a negative month, we draw a 0 won baseline.
- Chart form: 3 line series (income, expense, balance) on one shared KRW axis.
  - The legend is always shown. We write the name next to the color so that series are not told apart by color alone.
  - Lines are 2px. For 12 months or fewer we draw dots (radius 4px, a 2px border in the card color), and for 24 months only the hovered month shows a dot.
  - Hovering shows a vertical line and the three values of that month in a tooltip.
- Colors: use dataviz baseline palette numbers 1 to 3 in this order (`--chart-series-1..3`, `index.css`).
  - Light: `#2a78d6` / `#eb6834` / `#1baf7a`. Dark: `#3987e5` / `#d95926` / `#199e70`.
  - They passed the validator for lightness, saturation, color-blind separation (ΔE 9.2 or more), and normal-vision separation.
  - Only the teal (balance) in light mode has a contrast of 2.8:1 against the white surface. So we keep the legend and the table together.
- Table: under "표로 보기" ("View as table", collapsible) we put month, income, expense, and balance, starting with the latest month. The unit "(원)" is written in the column title, so the four columns fit on one line even on a phone.
- For screen readers, the chart is announced as one image ("…부터 …까지 월별 수입·지출·잔액 꺾은선 차트. 모든 값은 아래 표로 보기에 있습니다.", "Line chart of monthly income, expenses, and balance from … to …. All values are in View as table below.").
- The chart file is loaded separately as in #40 (`trend-chart` 24 kB, with Recharts shared with the #40 chart).
  - If loading fails, the error boundary shows a notice.
  - Changing the period or pressing "추이 다시 시도" ("Retry trend") loads it again.
- Month validation moved the same rules as #40 into `backend/src/month.ts` to share them. The messages carry the field name ("시작 월을 …", "Start month …", "끝 월을 …", "End month …"). The summary API's message is unchanged ("월을 …", "Month …").

## Changes

- `backend/src/trend.ts`, `backend/src/app.ts`: `GET /api/ledger/trend?from=YYYY-MM&to=YYYY-MM` → `{ from, to, months: [{ month, income, expense, balance }] }` (oldest month first).
  - A format or range (1900 to 2100) error, a start month later than the end month, and a period over 24 months are Korean 400s.
- `backend/src/month.ts`, `backend/src/summary.ts`: moved the month validation and `won()` to be shared.
- `frontend/src/monthly-trend.tsx`: the "월별 추이" ("Monthly trend") section. Period buttons (`aria-pressed`), the period display, the chart, the table, and loading, empty period, and failure with retry. Only the last request is reflected.
- `frontend/src/trend-chart.tsx`: the Recharts line chart. `frontend/src/trend-series.ts`: series order, names, colors, and period choices.
- `frontend/src/ledger.tsx`: placed under the monthly summary, and reloads when entries change.
- `frontend/src/index.css`: chart color tokens 2 and 3.

## Tests

- `backend/test/trend.test.ts`: 9 bad periods are Korean 400 before the DB (missing, one side missing, format, month 13, given twice, years 1899 and 2101, order, 25 months).
- `backend/test/trend.integration.test.ts`: checks on a real DB.
  - Every month of the period appears and an empty month is 0. Each month equals the direct sum of that month's entries (excluding before and after the period).
  - A period across years, a one-month period, 24 months, and 1900-01 and 2100-12.
  - Month boundary: entries on day 1 and the last day land in the same month regardless of the DB session time zone (Seoul, UTC, Los Angeles, and Kiritimati +14).
- `frontend/src/monthly-trend.test.tsx`: checks the screen.
  - 12 months up to this month in Seoul time. In UTC it is November 30, but in Seoul it is December 1.
  - A 0 for an empty month in the table, the period buttons and the address (keeping other values), and the period and a bad period in the address.
  - A period with no entries, hiding the previous period on failure and retry (focus), reloading on a version change, and ignoring an old period's response that arrives late.
- `frontend/src/trend-chart.test.tsx`: the chart image name and the legend order and colors (color only on the display bar, and the text uses the text color).
- `frontend/src/app.test.tsx`: added `months: []` to the empty response mock (the ledger screen loads the trend).

## Verification

- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 281 passed (0 skipped), frontend 239 of 241 passed and 2 skipped (existing), 4 skill tests, build succeeded.
  - The build's 500 kB warning existed before. The trend chart file is 24 kB.
  - We merged origin/main (#47 asset valuation). We resolved the `backend/src/app.ts` conflict by keeping both routers. We applied migrations 015 and 016 to the test DB. It passed again after the merge: backend 295 (0 skipped), frontend 248 of 250 passed and 2 skipped (existing).
- Browser: we connected the API (3192) to the test DB and checked `/ledger` with Vite (5292) in headless Chrome (CDP).
  - Data we put in: entries from 2024-12 to 2026-11. A salary of 3,200,000 won every month (except March and October), no entries in March, and in October income of 500,000 won and expenses of 3,730,000 won.
  - 390×844:
    - The default 12 months (December 2025 to November 2026) show 3 lines (2px), 36 dots, and the 0 won baseline. The chart fits inside the card (308px wide).
    - Hovering over October shows "2026년 10월 / 수입 500,000원 / 지출 3,730,000원 / 잔액 -3,230,000원" ("October 2026 / Income 500,000 won / Expenses 3,730,000 won / Balance -3,230,000 won").
    - View as table has 13 rows, and March is 0. At first the amount cells stuck together and went outside the card, so we moved the unit to the column title. After the fix it fits inside the card.
    - 6 months shows 18 dots at `?trend=6`, and 24 months shows only lines without dots at `?trend=24`.
    - In dark mode the line colors change to `#3987e5`/`#d95926`/`#199e70`. The legend text uses the text color.
    - No horizontal overflow (scrollWidth 390).
  - 1440×900: the same results (chart width 1038px). We fixed the horizontal axis ticks being dropped unevenly with `equidistantPreserveStart`. There is no horizontal overflow in light or dark.

## Round 1 automatic review (PR #111)

There was no blocking problem. What the review confirmed: the #40 summary API message is unchanged, the address's `month`, filters, and `trend` do not clear each other, an empty month is 0, month boundaries in Seoul time, ignoring late responses, and hiding the previous period on failure.

2 low points:

1. The SQL comment in `backend/src/trend.ts` said "it does not depend on the session time zone", but `generate_series` makes timestamps in the session time zone. It uses the same time zone for `to_char`, so the result is right (tested in 4 time zones). → We fixed the comment to the real behavior.
2. If the data arrived but only the chart file failed to load, there is no "다시 시도" in that place. Changing the period loads it again, and the values are in the table. It is the same behavior as the #40 summary, so we left it.

Verification: only a comment changed, so we reran `npm run format:check`, `npm run lint`, and `npm run typecheck`, and they passed.

## CI failure and fix

- The CI `verify` of the commit that addressed the first review failed at the `npm run knip` step. `maxTrendMonths` in `backend/src/trend.ts` was only exported and not used elsewhere. Tests and the build passed.
- → We removed the export. `npm run knip` is not part of `npm run check`, so we missed it locally. This time we ran it directly and confirmed it passes, and `typecheck` and the backend tests passed too.
