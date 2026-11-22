# #102 Count KRX rows with no trades as missing days

- Issue: [#102](https://github.com/sirloinbh/money-ledger/issues/102)
- Branch: `feat/102-halted-missing-days`
- Parent: #80

## Purpose

The #97 rule makes a Korean security inactive after 10 market days missing from the KRX data. Real answers (KRX key, 2026-11-23) show that KRX keeps listing a halted stock at its last close with open 0 and volume 0. For example, `000300` DH오토넥스 had close 4200, `TDD_OPNPRC` 0 and `ACC_TRDVOL` 0 on 2026-11-13 and 2026-11-19. Such a stock never counted as missing, so it stayed active and could be bought in mock orders.

User decision (2026-11-23, issue comment): **no trades = missing day.** A row with `ACC_TRDVOL` = 0 and `TDD_OPNPRC` = 0 counts as a missing day. Very illiquid ETFs with no trades fall under the same rule.

## Changes

- `backend/src/prices/krx.ts`
  - `parseKrxDaily` leaves out a row whose volume and open are both zero, the same way it leaves out a row without a close. Its close is not stored and `krx_last_seen` does not move, so the existing #97 check makes it inactive after 10 market days (buys blocked, sells allowed). One traded day makes it active again.
  - The parser now also requires `TDD_OPNPRC` and `ACC_TRDVOL` in every item. An answer without them is a `SourceError`, like a missing close (#193), so a format change cannot quietly keep halted stocks buyable.
  - `ISU_SRT_CD` is no longer read. The real answers have only `ISU_CD`, which is already the 6-character short code.
  - The comment that said the fields come from secondary sources now names the checked fields.
- `docs/price-source.md`
  - The #97 section has the #102 rule and the evidence.
  - The "not verified with real keys" note is split: KRX is checked (address, real fields, data out the next business day, weekend answers), Eximbank is still not verified.
- Weekend rows: the ETF endpoint answered 1,183 rows with `BAS_DD=20261031` for Saturday 2026-10-31 (and for Sunday 2026-11-01), but every close, open and volume in them was empty. The stock endpoints answered no rows. `parseKrxDaily` drops rows without a close, so such an answer stores no closes and no market day. The fetch already stores only trading days, so no new issue was filed.

## Verification

Live KRX checks (2026-11-23, with the real key from the main worktree's `.env`; the key was never printed or stored):

| Endpoint, date                | Rows  | Rows with a close | Open 0 and volume 0 |
| ----------------------------- | ----- | ----------------- | ------------------- |
| `sto/stk_bydd_trd` 2026-11-19 | 936   | all               | 24                  |
| `sto/ksq_bydd_trd` 2026-11-19 | 1,835 | 1,835             | 86                  |
| `etp/etf_bydd_trd` 2026-10-30 | 1,183 | all               | 13                  |
| `etp/etf_bydd_trd` 2026-10-31 | 1,183 | 0                 | 0                   |
| `etp/etf_bydd_trd` 2026-11-01 | 1,183 | 0                 | 0                   |
| `sto/stk_bydd_trd` 2026-10-31 | 0     | 0                 | 0                   |
| `sto/ksq_bydd_trd` 2026-10-31 | 0     | 0                 | 0                   |

Tests:

- `backend/test/prices.test.ts`
  - A halted row (close 4200, open 0, volume 0) is dropped. Open 0 alone and volume 0 alone are kept.
  - A weekend ETF answer with empty values parses to no rows.
  - An item without `ACC_TRDVOL` fails like one without a close.
  - Fixtures now carry every value as a string, as the real answer does.
- `backend/test/prices.integration.test.ts`: a stock listed with no trades for 9 market days stays active, and no closes are stored for those days. On the 10th it becomes inactive, keeping the last traded close (2026-11-02), while the traded stock stays active. A traded day makes it active again.
- With the `origin/main` `krx.ts`, these 3 tests fail (plus their parent DB test); with the change, both files pass: 47 tests, 0 skipped, against the agent1 test DB.
- `npm run check` (`TEST_DATABASE_URL` on the agent1 test DB): pass. Backend 464 pass, 0 skipped; frontend 550 passed, 3 skipped (managed `skipIf` tests); format, lint, contract, typecheck, skills and build pass.
- `npm run knip`: pass.

## Limits

- A halted day stores no close, so a halted stock's quote keeps its last traded date and shows "Price delayed" after 5 days, which matches reality (no trade).
- A security that first appears already halted is not created until it trades.
