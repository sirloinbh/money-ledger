# Sell day trades automatically at +5% or -3% (#309)

Step 5 of mock investing v2 ([#303](https://github.com/sirloinbh/money-ledger/issues/303)). Stacked on #307 (positions, strategy, `sellPosition`) and #305 (live quotes).

| File                                                | Change                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/mock/day-trade.ts`                     | `runDayTradeCheck` (one check at a given time) and `dayTradeQueue` (pg-boss, every minute 09:00-15:59 KST on weekdays, singleton, no retries; the handler keeps to 09:00-15:20)                                                                                   |
| `backend/src/mock/positions.ts`                     | `sellPosition` takes an optional `reason` (`take_profit`, `stop_loss`, default `manual`); closing a position now also stores the net gain in KRW and percent, computed in SQL numeric. Positions expose `exitReason`, `netGainKrw`, `netGainPct`, `carriedOverAt` |
| `database/migrations/041_mock_position_exit.sql`    | `exit_reason`, `net_gain_krw`, `net_gain_pct`, `carried_over_at` on `mock_positions`. Numbered 041, not 031: the runner refuses a file numbered before an applied one, and #307 already uses 040                                                                  |
| `backend/src/server.ts`                             | One line registers the queue                                                                                                                                                                                                                                      |
| `backend/test/day-trade*.test.ts`                   | Unit tests for the window and holidays; DB tests for both triggers and their exact boundaries, the best-bid fill, no double sale, long holds left alone, the 15:20 carry-over, market closed, and a KIS failure                                                   |
| `backend/test/mock-{positions,orders}.integration…` | Their setup also applies 041                                                                                                                                                                                                                                      |

## Rules

- Trigger: current price >= buy fill price x 1.05 sells as `take_profit`; <= x 0.97 as `stop_loss`. The comparison is SQL `numeric`. Exactly 73,605 / 67,997 for a 70,100 buy sells; one won inside does not. The sale is at the best bid, so the gain can differ from 5% / -3%.
- Net gain = sale amount - fee - tax - (buy amount + buy fee); percent = net gain / (buy amount + buy fee), 2 places, half away from zero. Example: 142 shares bought at 70,100 and sold at 73,605 gain 473,745 won (4.76%).
- Overlapping runs make one sale: `sellPosition` locks the account and the position and refuses a closed one.
- **Decision (recommendation taken): a day trade that reaches neither level by 15:20 keeps being held and becomes a long hold** (`strategy_source = 'auto'`, `carried_over_at` set), so the next morning's keep-or-sell question (#310) asks the user. A day trade still open on a later day (for example a missed 15:20 run) is carried over the same way before any trigger is looked at. A buy after 15:20 is carried over the next morning.
- Trading days: weekdays. The KRX holiday calendar is #321 and plugs in through the `isTradingDay` option. Until then a holiday is caught by KIS answering with an empty book (market closed), which ends the run without selling or carrying anything over.
- The run returns what happened (`sold`, `carriedOver`, `alreadySold`, `failed`) so the event wiring (#313) can tell the user.

## Checks

See the PR for the commands and results. The real KIS key is not checked (waiting on #304).
