import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';

import { createApp, serviceDate } from './app.js';
import { baseRateSourceFromEnv, benchmarkQueue } from './benchmark-fetch.js';
import { dailySavesQueue } from './daily-saves.js';
import { kakaoConfigFromEnv } from './kakao/api.js';
import { comparisonFor } from './kakao/comparison.js';
import { kakaoDailySummaryQueue } from './kakao/daily-summary.js';
import { notifyDayTradeSales } from './kakao/day-trade-events.js';
import { createNotifier } from './kakao/notifier.js';
import { notifyPickBought } from './kakao/pick-events.js';
import { createKakaoService } from './kakao/service.js';
import { skillConfigFromEnv } from './kakao/skill.js';
import { dayTradeQueue } from './mock/day-trade.js';
import { snapshotOpenAccount } from './mock/snapshots.js';
import { logNewsEvent, newsQueue, newsSourceFromEnv } from './news/index.js';
import {
  claudeFromEnv,
  logPickEvent,
  pickBuyDeps,
  type PickDeps,
  pickQueue,
} from './picks/index.js';
import {
  liveSourceFromEnv,
  logPriceEvent,
  PRICE_QUEUE,
  priceQueue,
  sourcesFromEnv,
} from './prices/index.js';
import { backgroundJobs, shutdownOnce } from './runtime.js';
import { listenHost, sharedAuth } from './standard/auth.js';
import { createPool } from './standard/db.js';
import { jobBossOptions, jobsModeFromEnv, startJobs } from './standard/jobs.js';

const port = Number(process.env.PORT ?? 3105);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
// createPool adds the 'error' listeners, so a lost idle connection is logged and does not end the process (#178).
const pool = createPool(new Pool({ connectionString: databaseUrl }));
const prices = sourcesFromEnv();
const news = newsSourceFromEnv();
const kis = liveSourceFromEnv();
const claude = claudeFromEnv();
// PRICE_JOBS=off still works (the old switch); JOBS_MODE=off|send is the shared one (docs: price-source.md).
const mode = process.env.PRICE_JOBS === 'off' ? 'off' : jobsModeFromEnv();
const jobs = backgroundJobs(mode);
// Without the sign-in (local development) the API listens on 127.0.0.1 only; with it, on every interface (#866, #898).
const auth = sharedAuth();
// #311 Without the Kakao settings the card says it is not set up; the web app is KAKAO_APP_URL, or the redirect URI's origin when both share one.
const kakaoConfig = kakaoConfigFromEnv();
const kakao = {
  service: createKakaoService(pool, { config: kakaoConfig }),
  appUrl: kakaoConfig ? (kakaoConfig.appUrl ?? new URL(kakaoConfig.redirectUri).origin) : undefined,
};
// #313 Every event (pick, sale, question, daily summary) goes out through this one notifier.
const notifier = createNotifier(kakao.service, { link: kakao.appUrl });
// #308 The daily pick: Claude plus the all-in buy of #307. Without an Anthropic key there is none. #313 The buy goes to KakaoTalk once it is saved.
const pick: PickDeps | undefined = claude
  ? {
      claude,
      ...pickBuyDeps(pool, kis, () => serviceDate()),
      onBought: (pickId) => notifyPickBought(pool, notifier, pickId, logPickEvent),
      log: logPickEvent,
    }
  : undefined;
const server = createApp(pool, {
  prices,
  kis,
  priceLog: logPriceEvent,
  news,
  newsLog: logNewsEvent,
  pick,
  auth,
  jobsStatus: jobs.status,
  toolsPublicKey: process.env.AI_TOOLS_PUBLIC_KEY,
  kakao,
  kakaoSkill: { config: skillConfigFromEnv() },
}).listen(port, listenHost(auth !== undefined), () => console.log(`API http://localhost:${port}`));
// #178: jobs start after the API listens; a start-up failure is logged and the API keeps serving.
// #235: a failed start is retried with a new PgBoss a few times (runtime.ts START_RETRY_DELAYS_MS).
void jobs.start(
  () => new PgBoss(jobBossOptions(databaseUrl)),
  (boss) =>
    startJobs(
      boss,
      // After each daily fetch the open mock account's value is saved for the return chart (#54).
      [
        priceQueue(pool, prices, logPriceEvent, (now) => snapshotOpenAccount(pool, now)),
        // #185 Fixed costs, finished reports and net worth once a day; the app's on-open calls stay as a fallback.
        dailySavesQueue(pool),
        // #309 Day trades are sold at +5% or -3% every minute during market hours.
        dayTradeQueue(pool, kis, () => serviceDate(), {
          log: logPriceEvent,
          // #313 Each sale goes to KakaoTalk once it is saved.
          onSold: (sold) => notifyDayTradeSales(pool, notifier, sold, serviceDate(), logPriceEvent),
        }),
        // #313 The account summary to KakaoTalk once a day after the close.
        kakaoDailySummaryQueue(pool, notifier, kakao.service, undefined, {
          // #294 The deposit, Buffett and Renaissance returns over the account's own period.
          comparison: (accountId, day) => comparisonFor(pool, accountId, day),
          // lastPrice works after the close too (it is the day's close then); when KIS cannot answer, the stored close is used.
          livePrice: kis ? async (symbol) => (await kis.lastPrice(symbol)).price : undefined,
        }),
        // #306 Economy headlines at 07:30 on weekdays, for the daily pick.
        newsQueue(pool, news, logNewsEvent),
        // #308 Claude's pick and the all-in buy at 08:00 on weekdays, after the news fetch.
        pickQueue(pool, pick),
        // #294 The Bank of Korea base rate for the deposit comparison.
        benchmarkQueue(pool, baseRateSourceFromEnv(), logPriceEvent),
      ],
      { mode },
    ),
  // A server that was off at 12:00 fetches once when it starts; the handler skips it when nothing is due.
  // No key: a `singleton` queue allows one running job per key, so a keyed job could overlap the cron's job.
  (started) => started.send(PRICE_QUEUE, {}),
);
const shutdown = shutdownOnce(server, jobs, pool);
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
