import type { Pool } from 'pg';

import type { KisSource } from '../prices/kis.js';
import { HttpError } from '../standard/http.js';
import type { JobQueue } from '../standard/jobs.js';
import { sellPosition } from './positions.js';
import { livePrice } from './quotes.js';

// #309 Day trade auto sell (epic #303, step 5).
// - The price is one `lastPrice` call per security (#325); the sale itself reads the order book (sellPosition).
// - Every minute from 09:00 to 15:20 KST on a trading day, each open `day_trade` position is checked against its
//   buy price: current price >= buy price x 1.05 sells it as 'take_profit', <= x 0.97 as 'stop_loss'. The sale is
//   sellPosition (#307): the whole position at the best bid, with commission and transaction tax. The trigger
//   compares the price with the buy fill price; the gain it records is net of fees and tax.
// - A position that is sold twice is impossible: sellPosition locks the account and the position and refuses a
//   closed one, so two overlapping runs make one sale and the other is counted as `alreadySold`.
// - Decision (#309, recommendation taken): a day trade that reached neither level by 15:20 keeps being held and is
//   turned into a long hold (strategy_source 'auto', carried_over_at set), so the morning keep-or-sell question
//   of #310 asks the user. The same happens at the first run of a later day to a day trade left over from an
//   earlier day (for example the 15:20 run was missed), before any trigger is looked at.
// - Trading days: weekdays by default. #321 plugs the KRX holiday calendar in through `isTradingDay`; until then
//   a holiday is caught by KIS answering with an empty order book (market closed), which ends the run quietly.

const TAKE_PROFIT_RATE = '1.05';
const STOP_LOSS_RATE = '0.97';
const openMinute = 9 * 60;
const closeMinute = 15 * 60 + 20;

type ExitReason = 'take_profit' | 'stop_loss';
export type DayTradeRun = {
  /** Why nothing was checked, or null when the run looked at the positions. */
  skipped: 'outside_hours' | 'not_trading_day' | 'market_closed' | null;
  /** Each sale with the closed position (security, quantity, sell price, net gain), for the user's message (#313). */
  sold: {
    positionId: number;
    reason: ExitReason;
    position: Awaited<ReturnType<typeof sellPosition>>;
  }[];
  /** Day trades turned into long holds, to be asked about the next morning. */
  carriedOver: number[];
  /** Positions another run sold first. */
  alreadySold: number[];
  /** Positions that could not be checked or sold this minute; the next run tries again. */
  failed: { positionId: number; message: string }[];
};

type Options = {
  /** `YYYY-MM-DD` in the service time zone: false on a market holiday. Default: Monday to Friday. */
  isTradingDay?: (date: string) => boolean;
  log?: (event: Record<string, unknown>) => void;
};

const weekday = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
};

/** Minutes since midnight in Asia/Seoul. */
function seoulMinute(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return part('hour') * 60 + part('minute');
}

type Open = { id: number; symbol: string; buy_price: string };

/**
 * One check at `now`. `today` is the service date. Returns what happened, so the event wiring (#313) can tell the
 * user. Safe to run twice and to run at the same time as itself.
 */
export async function runDayTradeCheck(
  pool: Pool,
  kis: KisSource | undefined,
  now: Date,
  today: () => string,
  options: Options = {},
): Promise<DayTradeRun> {
  const run: DayTradeRun = {
    skipped: null,
    sold: [],
    carriedOver: [],
    alreadySold: [],
    failed: [],
  };
  const log = options.log ?? (() => undefined);
  const day = today();
  const minute = seoulMinute(now);
  if (!(options.isTradingDay ?? weekday)(day)) return { ...run, skipped: 'not_trading_day' };
  if (minute < openMinute || minute > closeMinute) return { ...run, skipped: 'outside_hours' };

  // A day trade left over from an earlier day is not a day trade any more: it is asked about like a long hold.
  const stale = await pool.query<{ id: number }>(
    `UPDATE mock_positions SET strategy = 'long_hold', strategy_chosen_at = now(), strategy_source = 'auto',
       carried_over_at = now()
     WHERE closed_at IS NULL AND strategy = 'day_trade'
       AND (opened_at AT TIME ZONE 'Asia/Seoul')::date < $1::date
     RETURNING id`,
    [day],
  );
  run.carriedOver.push(...stale.rows.map((row) => row.id));

  const { rows } = await pool.query<Open>(
    `SELECT p.id, s.symbol, b.price AS buy_price
     FROM mock_positions p
     JOIN securities s ON s.id = p.security_id
     JOIN mock_orders b ON b.id = p.buy_order_id
     WHERE p.closed_at IS NULL AND p.strategy = 'day_trade'
     ORDER BY p.id`,
  );

  const quotes = new Map<string, string>();
  for (const position of rows) {
    try {
      let price = quotes.get(position.symbol);
      if (price === undefined) {
        price = (await livePrice(kis, position.symbol)).price;
        quotes.set(position.symbol, price);
      }
      // Compared in SQL numeric, never as JS numbers (AGENTS.project.md).
      const { rows: verdict } = await pool.query<{ up: boolean; down: boolean }>(
        `SELECT $1::numeric >= $2::numeric * $3::numeric AS up, $1::numeric <= $2::numeric * $4::numeric AS down`,
        [price, position.buy_price, TAKE_PROFIT_RATE, STOP_LOSS_RATE],
      );
      const reason: ExitReason | null = verdict[0].up
        ? 'take_profit'
        : verdict[0].down
          ? 'stop_loss'
          : null;
      if (reason === null) continue;
      const closed = await sellPosition(pool, kis, today, position.id, reason);
      run.sold.push({ positionId: position.id, reason, position: closed });
      log({ event: 'day_trade_sold', positionId: position.id, reason });
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        // The market is closed (a holiday the calendar does not know): nothing more to do this minute.
        if (/market is closed/i.test(error.message)) return { ...run, skipped: 'market_closed' };
        if (/already sold/i.test(error.message)) {
          run.alreadySold.push(position.id);
          continue;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      run.failed.push({ positionId: position.id, message });
      log({ event: 'day_trade_failed', positionId: position.id, message });
    }
  }

  if (minute >= closeMinute) {
    const sold = new Set(run.sold.map((item) => item.positionId));
    const leftover = rows.map((row) => row.id).filter((id) => !sold.has(id));
    if (leftover.length > 0) {
      const carried = await pool.query<{ id: number }>(
        `UPDATE mock_positions SET strategy = 'long_hold', strategy_chosen_at = now(), strategy_source = 'auto',
           carried_over_at = now()
         WHERE id = ANY($1::bigint[]) AND closed_at IS NULL AND strategy = 'day_trade'
         RETURNING id`,
        [leftover],
      );
      run.carriedOver.push(...carried.rows.map((row) => row.id));
    }
  }
  return run;
}

const DAY_TRADE_QUEUE = 'day-trade-check';

/**
 * The day trade check as a pg-boss queue, every minute from 09:00 to 15:59 KST on weekdays (cron is in
 * Asia/Seoul); the handler itself keeps to 09:00-15:20 and the trading days. `singleton` and no retries: the
 * next minute is the retry, and a slow run must not start a second one beside it.
 */
export function dayTradeQueue(
  pool: Pool,
  kis: KisSource | undefined,
  today: () => string,
  options: Options = {},
  now: () => Date = () => new Date(),
): JobQueue {
  return {
    name: DAY_TRADE_QUEUE,
    policy: 'singleton',
    retryLimit: 0,
    schedule: '* 9-15 * * 1-5',
    handler: async () => {
      await runDayTradeCheck(pool, kis, now(), today, options);
    },
  };
}
