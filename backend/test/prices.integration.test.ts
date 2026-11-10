import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { fakeSources } from '../src/prices/fake.js';
import { dailyTiingoLimit, runDailyFetch, tiingoHourlyLimit } from '../src/prices/fetch.js';
import { runIfDue } from '../src/prices/scheduler.js';
import { type PriceSources, SourceError } from '../src/prices/sources.js';
import { saveKrxDay } from '../src/prices/store.js';
import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Quote = { close: string; currency: string; tradeDate: string; stale: boolean };
type Found = {
  id: number;
  symbol: string;
  name: string | null;
  market: string;
  quote: Quote | null;
};
type Detail = {
  security: Found;
  quote: Quote | null;
  quoteIssue: string | null;
  fx: { fxRate: string; rateDate: string; stale: boolean } | null;
};

const quiet = () => undefined;
// Monday 2026-11-09 12:00 in Seoul.
const noon = new Date('2026-11-09T03:00:00Z');
const at = (iso: string) => new Date(iso);

/** The fake sources, counting every call each one gets. */
function counted() {
  const fake = fakeSources();
  const calls = {
    krx: [] as string[],
    fx: [] as string[],
    closes: [] as string[],
    tickers: 0,
    names: 0,
  };
  const sources = {
    krx: {
      name: fake.krx.name,
      daily: (market: Parameters<typeof fake.krx.daily>[0], date: string) => {
        calls.krx.push(`${market} ${date}`);
        return fake.krx.daily(market, date);
      },
    },
    fx: {
      name: fake.fx.name,
      usd: (date: string) => {
        calls.fx.push(date);
        return fake.fx.usd(date);
      },
    },
    tiingo: {
      name: fake.tiingo.name,
      tickers: () => {
        calls.tickers += 1;
        return fake.tiingo.tickers();
      },
      closes: (symbol: string, start: string, end: string) => {
        calls.closes.push(`${symbol} ${start}~${end}`);
        return fake.tiingo.closes(symbol, start, end);
      },
      companyName: (symbol: string) => {
        calls.names += 1;
        return fake.tiingo.companyName(symbol);
      },
    },
  } satisfies Required<PriceSources>;
  return { sources, calls };
}

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('shared price store against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query(
      'DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets, mock_orders, mock_holdings, security_prices, fx_rates, price_fetch_state, price_api_calls, krx_market_days, securities',
    );
    await runMigration(pool, '009_prices.sql');
    await runMigration(pool, '012_krx_listing.sql');
    // re-running is safe
    await runMigration(pool, '009_prices.sql');
    await runMigration(pool, '012_krx_listing.sql');
    // The daily fetch also covers US securities linked to portfolio assets (#47) and held in the mock
    // account (#53).
    for (const file of [
      '004_portfolio_assets.sql',
      '007_depreciable_assets.sql',
      '010_prepaid_assets.sql',
      '013_asset_trades.sql',
      '016_asset_valuation.sql',
      '005_mock_accounts.sql',
      '015_mock_orders.sql',
    ]) {
      await runMigration(pool, file);
    }
  };
  const closesOf = async (symbol: string) =>
    (
      await pool.query<{ trade_date: string; close: string }>(
        `SELECT p.trade_date, p.close FROM security_prices p JOIN securities s ON s.id = p.security_id
         WHERE s.symbol = $1 ORDER BY p.trade_date`,
        [symbol],
      )
    ).rows;
  const state = async (source: string, scope: string) =>
    (
      await pool.query<{ checked_through: string | null; last_error: string | null }>(
        'SELECT checked_through, last_error FROM price_fetch_state WHERE source = $1 AND scope = $2',
        [source, scope],
      )
    ).rows[0];

  await t.test(
    'the first run fetches the last 10 days; the next run asks for nothing',
    async () => {
      await reset();
      const { sources, calls } = counted();
      const first = await runDailyFetch(pool, sources, noon, quiet);
      assert.deepEqual(first, { complete: true });
      // KRX up to yesterday (Sunday 11-08) for three markets, 10 days each.
      assert.equal(calls.krx.length, 30);
      assert.ok(calls.krx.includes('KOSPI 2026-10-30') && calls.krx.includes('KRX_ETF 2026-11-08'));
      // Weekends are empty answers, not failures: only the 6 weekdays have closes.
      assert.deepEqual(
        (await closesOf('005930')).map((row) => row.trade_date),
        ['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
      );
      assert.equal((await closesOf('005930')).at(-1)?.close, '70600.0000');
      // The latest day (Sunday) came back empty, so it is not checked yet: its values may still come out.
      assert.deepEqual(await state('KRX', 'KOSPI'), {
        checked_through: '2026-11-07',
        last_error: null,
      });
      // The rate goes up to today.
      assert.equal(calls.fx.at(-1), '2026-11-09');
      const rates = await pool.query(
        'SELECT rate_date, fx_rate FROM fx_rates ORDER BY rate_date DESC',
      );
      assert.deepEqual(rates.rows[0], { rate_date: '2026-11-09', fx_rate: '1384.5000' });
      // The US list is loaded, without names. Nothing is tracked yet, so no US closes are fetched.
      assert.equal(calls.tickers, 1);
      assert.deepEqual(calls.closes, []);
      const aapl = await pool.query(
        "SELECT market, kind, name, active FROM securities WHERE symbol = 'AAPL'",
      );
      assert.deepEqual(aapl.rows[0], { market: 'NASDAQ', kind: 'stock', name: null, active: true });

      const again = counted();
      assert.deepEqual(
        await runDailyFetch(pool, again.sources, at('2026-11-09T05:00:00Z'), quiet),
        {
          complete: true,
        },
      );
      // Only the empty latest day is asked for again; today's rate already came back.
      assert.deepEqual(again.calls.krx, [
        'KOSPI 2026-11-08',
        'KOSDAQ 2026-11-08',
        'KRX_ETF 2026-11-08',
      ]);
      assert.deepEqual(again.calls.fx, []);
      assert.equal(again.calls.tickers, 0); // weekly

      // Two days later only the new days are asked for.
      const later = counted();
      await runDailyFetch(pool, later.sources, at('2026-11-11T03:00:00Z'), quiet);
      assert.deepEqual(
        later.calls.krx.filter((call) => call.startsWith('KOSPI')),
        ['KOSPI 2026-11-08', 'KOSPI 2026-11-09', 'KOSPI 2026-11-10'],
      );
      assert.deepEqual(later.calls.fx, ['2026-11-10', '2026-11-11']);
    },
  );

  await t.test('a failed day is kept for the retry and the error is recorded', async () => {
    await reset();
    const { sources } = counted();
    const broken = {
      ...sources,
      krx: {
        name: 'FAKE',
        daily: (market: 'KOSPI' | 'KOSDAQ' | 'KRX_ETF', date: string) =>
          market === 'KOSDAQ' && date === '2026-11-04'
            ? Promise.reject(new SourceError('KRX 시세 응답 오류 (HTTP 503)'))
            : sources.krx.daily(market, date),
      },
    };
    const logged: Record<string, unknown>[] = [];
    const result = await runDailyFetch(pool, broken, noon, (event) => logged.push(event));
    assert.deepEqual(result, { complete: false });
    assert.deepEqual(await state('KRX', 'KOSDAQ'), {
      checked_through: '2026-11-03',
      last_error: 'KRX 시세 응답 오류 (HTTP 503)',
    });
    // Other markets are not held back.
    assert.equal((await state('KRX', 'KOSPI'))?.checked_through, '2026-11-07');
    assert.ok(
      logged.some((event) => event.event === 'price_fetch_failed' && event.scope === 'KOSDAQ'),
    );

    const retry = counted();
    assert.deepEqual(await runDailyFetch(pool, retry.sources, at('2026-11-09T04:00:00Z'), quiet), {
      complete: true,
    });
    assert.deepEqual(
      retry.calls.krx.filter((call) => call.startsWith('KOSDAQ')),
      [
        'KOSDAQ 2026-11-04',
        'KOSDAQ 2026-11-05',
        'KOSDAQ 2026-11-06',
        'KOSDAQ 2026-11-07',
        'KOSDAQ 2026-11-08',
      ],
    );
    assert.deepEqual(await state('KRX', 'KOSDAQ'), {
      checked_through: '2026-11-07',
      last_error: null,
    });
  });

  await t.test(
    'a source without a key is skipped and logged, not retried as a failure',
    async () => {
      await reset();
      const logged: Record<string, unknown>[] = [];
      const result = await runDailyFetch(pool, {}, noon, (event) => logged.push(event));
      assert.deepEqual(result, { complete: true });
      assert.deepEqual(
        logged.map((event) => [event.event, event.source, event.message]),
        [
          ['price_source_missing', 'KRX', '시세 출처가 설정되지 않았습니다'],
          ['price_source_missing', 'KOREAEXIM', '시세 출처가 설정되지 않았습니다'],
          ['price_source_missing', 'TIINGO', '시세 출처가 설정되지 않았습니다'],
        ],
      );
    },
  );

  await t.test(
    'the job runs from 12:00, retries hourly until 18:00 and once after a late start',
    async () => {
      await reset();
      let fail = true;
      const { sources } = counted();
      const flaky = {
        ...sources,
        fx: {
          name: 'FAKE',
          usd: (date: string) =>
            fail
              ? Promise.reject(new SourceError('수출입은행 환율에 연결하지 못했습니다'))
              : sources.fx.usd(date),
        },
      };
      const due = (iso: string) => runIfDue(pool, flaky, at(iso), quiet);
      assert.equal(await due('2026-11-09T02:59:00Z'), false); // 11:59
      assert.equal(await due('2026-11-09T03:00:00Z'), true); // 12:00, fails
      assert.equal(await due('2026-11-09T03:30:00Z'), false); // same hour
      assert.equal(await due('2026-11-09T04:00:00Z'), true); // 13:00 retry, fails
      assert.equal(await due('2026-11-09T09:10:00Z'), true); // 18:10, last retry, fails
      assert.equal(await due('2026-11-09T10:10:00Z'), false); // 19:10: no more retries today
      fail = false;
      assert.equal(await due('2026-11-10T03:00:00Z'), true); // next day 12:00, succeeds
      assert.equal(await due('2026-11-10T04:00:00Z'), false); // done for today

      // The server was off at 12:00 and starts at 20:00: it fetches once.
      assert.equal(await due('2026-11-11T11:00:00Z'), true);
      assert.equal(await due('2026-11-11T12:00:00Z'), false);
    },
  );

  await t.test(
    'each run of the daily fetch calls the after-fetch step; its failure is logged apart (#54)',
    async () => {
      await reset();
      const runs: string[] = [];
      const logged: Record<string, unknown>[] = [];
      const log = (event: Record<string, unknown>) => logged.push(event);
      assert.equal(
        await runIfDue(pool, counted().sources, noon, log, (now) => {
          runs.push(now.toISOString());
          return Promise.reject(new Error('snapshot failed'));
        }),
        true,
      );
      assert.deepEqual(runs, [noon.toISOString()]);
      assert.ok(
        logged.some(
          (event) =>
            event.event === 'price_after_fetch_error' && event.message === 'snapshot failed',
        ),
      );
      // The fetch itself still counts as done for today.
      assert.equal(
        await runIfDue(pool, counted().sources, at('2026-11-09T04:00:00Z'), log, () => {
          runs.push('again');
          return Promise.resolve();
        }),
        false,
      );
      assert.equal(runs.length, 1);
    },
  );

  await t.test(
    'search finds Korean names and codes and US tickers, with the latest close',
    async () => {
      await reset();
      await runDailyFetch(pool, counted().sources, noon, quiet);
      await withApi(
        pool,
        async (call) => {
          const byName = await call(`/api/prices/securities?q=${encodeURIComponent('삼성')}`);
          assert.equal(byName.status, 200);
          const found = byName.data.securities as Found[];
          assert.deepEqual(
            found.map((item) => [item.symbol, item.name, item.market, item.quote]),
            [
              [
                '005930',
                '삼성전자',
                'KOSPI',
                {
                  close: '70600.0000',
                  currency: 'KRW',
                  tradeDate: '2026-11-06',
                  fetchedAt: noon.toISOString(),
                  stale: false,
                },
              ],
            ],
          );
          const byCode = (await call('/api/prices/securities?q=0059')).data.securities as Found[];
          assert.deepEqual(
            byCode.map((item) => item.symbol),
            ['005930'],
          );

          // US: ticker only, no close until the detail is opened.
          const us = (await call('/api/prices/securities?q=aapl')).data.securities as Found[];
          assert.deepEqual(
            us.map((item) => [item.symbol, item.name, item.quote]),
            [['AAPL', null, null]],
          );
          assert.deepEqual((await call('/api/prices/securities?q=Apple')).data.securities, []);
          // LIKE wildcards typed by the user match themselves.
          assert.deepEqual((await call('/api/prices/securities?q=%25')).data.securities, []);
          assert.deepEqual((await call('/api/prices/securities?q=_')).data.securities, []);
          // An exact ticker comes before longer ones that start with it.
          await pool.query(
            "INSERT INTO securities (market, symbol, kind, currency) VALUES ('NYSE', 'MS', 'stock', 'USD')",
          );
          const ms = (await call('/api/prices/securities?q=ms')).data.securities as Found[];
          assert.deepEqual(
            ms.map((item) => item.symbol),
            ['MS', 'MSFT'],
          );
        },
        { today: () => '2026-11-09' },
      );
    },
  );

  await t.test('opening a US security fetches its closes and name now and tracks it', async () => {
    await reset();
    const { sources, calls } = counted();
    await runDailyFetch(pool, sources, noon, quiet);
    const options = {
      today: () => '2026-11-09',
      now: () => at('2026-11-09T04:00:00Z'),
      prices: sources,
    };
    await withApi(
      pool,
      async (call) => {
        const id = ((await call('/api/prices/securities?q=AAPL')).data.securities as Found[])[0].id;
        const opened = await call(`/api/prices/securities/${id}`);
        assert.equal(opened.status, 200);
        const detail = opened.data as Detail;
        assert.deepEqual(detail.security.name, 'Apple Inc');
        assert.deepEqual(
          { ...detail.quote, fetchedAt: undefined },
          {
            close: '231.5000',
            currency: 'USD',
            tradeDate: '2026-11-06',
            fetchedAt: undefined,
            stale: false,
          },
        );
        assert.equal(detail.quoteIssue, null);
        assert.deepEqual(detail.fx, { fxRate: '1384.5000', rateDate: '2026-11-09', stale: false });
        assert.deepEqual(calls.closes, ['AAPL 2026-10-30~2026-11-08']);
        assert.equal(calls.names, 1);

        // Tracked now: opening it again does not call Tiingo, and the name is searchable.
        await call(`/api/prices/securities/${id}`);
        assert.equal(calls.closes.length, 1);
        assert.equal(calls.names, 1);
        const byName = (await call('/api/prices/securities?q=apple')).data.securities as Found[];
        assert.deepEqual(
          byName.map((item) => item.symbol),
          ['AAPL'],
        );
      },
      options,
    );

    // The latest US day at the first open was Sunday 11-08: empty, but a weekend, so it counts as checked
    // and an hourly retry the same day does not call Tiingo again.
    const retry = counted();
    await runDailyFetch(pool, retry.sources, at('2026-11-09T05:00:00Z'), quiet);
    assert.deepEqual(retry.calls.closes, []);
    // The next day's fetch includes it, from the day after its checked date.
    const next = counted();
    await runDailyFetch(pool, next.sources, at('2026-11-10T03:00:00Z'), quiet);
    assert.deepEqual(next.calls.closes, ['AAPL 2026-11-09~2026-11-09']);
    // 30 days after the last open it drops off the daily fetch.
    const month = counted();
    await runDailyFetch(pool, month.sources, at('2026-12-10T03:00:00Z'), quiet);
    assert.deepEqual(month.calls.closes, []);
  });

  await t.test('a Korean security shows its stored close, delayed after 5 days', async () => {
    await reset();
    await runDailyFetch(pool, counted().sources, noon, quiet);
    const id = (
      await pool.query<{ id: string }>("SELECT id FROM securities WHERE symbol = '005930'")
    ).rows[0].id;
    const detailOn = async (today: string) => {
      let detail: Detail | undefined;
      await withApi(
        pool,
        async (call) => {
          detail = (await call(`/api/prices/securities/${id}`)).data as Detail;
        },
        { today: () => today },
      );
      return detail!;
    };
    const fresh = await detailOn('2026-11-11'); // 5 days after 11-06
    assert.deepEqual(
      [fresh.quote?.tradeDate, fresh.quote?.stale, fresh.fx],
      ['2026-11-06', false, null],
    );
    const late = await detailOn('2026-11-12'); // 6 days
    assert.equal(late.quote?.stale, true);
    assert.equal(late.quoteIssue, null);

    // A Korean security with no close yet (first day of listing).
    const fresh2 = await pool.query<{ id: string }>(
      "INSERT INTO securities (market, symbol, name, kind, currency) VALUES ('KOSDAQ', '0009A0', '신규상장', 'stock', 'KRW') RETURNING id",
    );
    await withApi(pool, async (call) => {
      const none = (await call(`/api/prices/securities/${fresh2.rows[0].id}`)).data as Detail;
      assert.deepEqual([none.quote, none.quoteIssue], [null, null]);
      const missing = await call('/api/prices/securities/999999');
      assert.deepEqual([missing.status, missing.data], [404, { error: '종목을 찾을 수 없습니다' }]);
    });
  });

  await t.test(
    'US quotes explain why they are missing: no key, rate limit, unknown ticker',
    async () => {
      await reset();
      await runDailyFetch(pool, counted().sources, noon, quiet);
      const ids = Object.fromEntries(
        (
          await pool.query<{ id: string; symbol: string }>(
            "SELECT id, symbol FROM securities WHERE currency = 'USD'",
          )
        ).rows.map((row) => [row.symbol, row.id]),
      );
      const now = at('2026-11-09T04:00:00Z');

      await withApi(
        pool,
        async (call) => {
          const detail = (await call(`/api/prices/securities/${ids.MSFT}`)).data as Detail;
          assert.deepEqual([detail.quote, detail.quoteIssue], [null, 'not_configured']);
        },
        { now: () => now },
      );

      // 50 calls in the last hour: screens get no more either.
      await pool.query(
        `INSERT INTO price_api_calls (source, called_at)
       SELECT 'TIINGO', $1::timestamptz - interval '30 minutes' FROM generate_series(1, $2)`,
        [now, tiingoHourlyLimit],
      );
      const { sources, calls } = counted();
      await withApi(
        pool,
        async (call) => {
          const detail = (await call(`/api/prices/securities/${ids.SPY}`)).data as Detail;
          assert.deepEqual([detail.quote, detail.quoteIssue], [null, 'rate_limited']);
          assert.deepEqual(calls.closes, []);
        },
        { now: () => now, prices: sources },
      );
      // An hour later the limit has room again, and the still-empty quote is fetched on the next open.
      await withApi(
        pool,
        async (call) => {
          const detail = (await call(`/api/prices/securities/${ids.SPY}`)).data as Detail;
          assert.equal(detail.quote?.tradeDate, '2026-11-06');
        },
        { now: () => at('2026-11-09T05:01:00Z'), prices: sources },
      );

      // A ticker Tiingo does not know.
      await pool.query(
        "INSERT INTO securities (market, symbol, kind, currency) VALUES ('NYSE', 'GONE', 'stock', 'USD')",
      );
      await withApi(
        pool,
        async (call) => {
          const id = ((await call('/api/prices/securities?q=GONE')).data.securities as Found[])[0]
            .id;
          const names = calls.names;
          const detail = (await call(`/api/prices/securities/${id}`)).data as Detail;
          assert.deepEqual([detail.quote, detail.quoteIssue], [null, 'not_found']);
          assert.equal(calls.names, names); // no call spent on a sure 404
        },
        { now: () => at('2026-11-09T05:02:00Z'), prices: sources },
      );
    },
  );

  await t.test('the daily fetch leaves 10 Tiingo calls an hour for screens', async () => {
    await reset();
    const { sources, calls } = counted();
    await runDailyFetch(pool, sources, noon, quiet);
    await pool.query("UPDATE securities SET viewed_at = $1 WHERE currency = 'USD'", [noon]);
    const next = at('2026-11-10T03:00:00Z');
    await pool.query(
      `INSERT INTO price_api_calls (source, called_at)
       SELECT 'TIINGO', $1::timestamptz - interval '10 minutes' FROM generate_series(1, $2)`,
      [next, dailyTiingoLimit - 2],
    );
    const logged: Record<string, unknown>[] = [];
    const result = await runDailyFetch(pool, sources, next, (event) => logged.push(event));
    assert.deepEqual(result, { complete: false });
    assert.equal(calls.closes.length, 2); // 4 tracked, room for 2
    assert.ok(logged.some((event) => event.event === 'price_fetch_limited'));
  });

  await t.test('US securities the open mock account holds stay on the daily fetch', async () => {
    await reset();
    await runDailyFetch(pool, counted().sources, noon, quiet);
    // Earlier tests in this database may have left an open account; only one can be open.
    await pool.query('UPDATE mock_accounts SET closed_at = now() WHERE closed_at IS NULL');
    const closed = await pool.query<{ id: string }>(
      `INSERT INTO mock_accounts (initial_cash_krw, cash_krw, created_at, closed_at)
       VALUES (10000000, 0, now(), now()) RETURNING id`,
    );
    const open = await pool.query<{ id: string }>(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 0) RETURNING id',
    );
    await pool.query(
      `INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw)
       SELECT $1::bigint, id, 1, 300000 FROM securities WHERE symbol = 'AAPL'
       UNION ALL SELECT $2::bigint, id, 1, 600000 FROM securities WHERE symbol = 'MSFT'`,
      [open.rows[0].id, closed.rows[0].id],
    );
    const { sources, calls } = counted();
    await runDailyFetch(pool, sources, at('2026-11-10T03:00:00Z'), quiet);
    // AAPL is held by the open account and never opened; MSFT only by a closed one.
    assert.deepEqual(
      calls.closes.map((call) => call.split(' ')[0]),
      ['AAPL'],
    );
  });

  await t.test(
    'the weekly US list marks tickers that left it inactive and hides them from search',
    async () => {
      await reset();
      await runDailyFetch(pool, counted().sources, noon, quiet);
      const { sources } = counted();
      const shorter = {
        ...sources,
        tiingo: {
          ...sources.tiingo,
          tickers: async () => (await sources.tiingo.tickers()).slice(1),
        },
      };
      const week = at('2026-11-16T03:00:00Z');
      await runDailyFetch(pool, shorter, week, quiet);
      const aapl = await pool.query("SELECT active FROM securities WHERE symbol = 'AAPL'");
      assert.equal(aapl.rows[0].active, false);
      await withApi(pool, async (call) => {
        assert.deepEqual((await call('/api/prices/securities?q=AAPL')).data.securities, []);
      });
    },
  );

  await t.test(
    'a latest value that is not out yet is asked for again on the next run',
    async () => {
      await reset();
      const { sources, calls } = counted();
      let published = false;
      const late = {
        ...sources,
        fx: {
          name: 'FAKE',
          usd: (date: string) =>
            date === '2026-11-10' && !published ? Promise.resolve(null) : sources.fx.usd(date),
        },
        tiingo: {
          ...sources.tiingo,
          closes: async (symbol: string, start: string, end: string) =>
            (await sources.tiingo.closes(symbol, start, end))?.filter(
              (close) => published || close.date !== '2026-11-09',
            ) ?? null,
        },
      };
      await pool.query(
        "INSERT INTO securities (market, symbol, kind, currency, viewed_at) VALUES ('NASDAQ', 'AAPL', 'stock', 'USD', $1)",
        [noon],
      );
      // Tuesday 12:00 in Seoul: the latest US day is Monday 11-09 and the latest rate day 11-10, both not out.
      await runDailyFetch(pool, late, at('2026-11-10T03:00:00Z'), quiet);
      assert.equal((await state('TIINGO', 'AAPL'))?.checked_through, '2026-11-08');
      assert.equal((await state('KOREAEXIM', 'USD'))?.checked_through, '2026-11-09');
      published = true;
      calls.closes.length = 0;
      calls.fx.length = 0;
      await runDailyFetch(pool, late, at('2026-11-10T04:00:00Z'), quiet);
      assert.deepEqual(calls.closes, ['AAPL 2026-11-09~2026-11-09']);
      assert.deepEqual(calls.fx, ['2026-11-10']);
      assert.equal((await closesOf('AAPL')).at(-1)?.trade_date, '2026-11-09');
      assert.equal((await state('TIINGO', 'AAPL'))?.checked_through, '2026-11-09');
      assert.equal((await state('KOREAEXIM', 'USD'))?.checked_through, '2026-11-10');
    },
  );

  await t.test('a US list less than half as long as the active one is refused', async () => {
    await reset();
    await runDailyFetch(pool, counted().sources, noon, quiet);
    const { sources } = counted();
    const truncated = {
      ...sources,
      tiingo: {
        ...sources.tiingo,
        tickers: async () => (await sources.tiingo.tickers()).slice(0, 1),
      },
    };
    const result = await runDailyFetch(pool, truncated, at('2026-11-16T03:00:00Z'), quiet);
    assert.deepEqual(result, { complete: false });
    const active = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM securities WHERE currency = 'USD' AND active",
    );
    assert.equal(active.rows[0].n, 4);
    assert.deepEqual(await state('TIINGO', 'tickers'), {
      checked_through: '2026-11-09',
      last_error: 'Tiingo 종목 목록이 평소보다 너무 짧아 저장하지 않았습니다',
    });
  });

  await t.test('only one server runs the daily fetch at a time', async () => {
    await reset();
    const other = await pool.connect();
    try {
      await other.query('SELECT pg_advisory_lock($1)', [510001]);
      assert.equal(await runIfDue(pool, counted().sources, noon, quiet), false);
      await other.query('SELECT pg_advisory_unlock($1)', [510001]);
      assert.equal(await runIfDue(pool, counted().sources, noon, quiet), true);
    } finally {
      other.release();
    }
  });

  await t.test(
    'a Korean security missing from 10 market days in a row becomes inactive (#97)',
    async () => {
      await reset();
      const samsung = { symbol: '005930', name: '삼성전자', close: '70000' };
      const halted = { symbol: '000660', name: 'SK하이닉스', close: '180000' };
      const days = [
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-09',
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
        '2026-11-16',
        '2026-11-17',
      ];
      const save = (date: string, rows: { symbol: string; name: string; close: string }[]) =>
        saveKrxDay(pool, 'KOSPI', date, rows, 'FAKE', noon);
      const activeOf = async (symbol: string) =>
        (
          await pool.query<{ active: boolean }>('SELECT active FROM securities WHERE symbol = $1', [
            symbol,
          ])
        ).rows[0].active;

      await save(days[0], [samsung, halted]);
      // Missing from 9 market days: still active. An empty answer (holiday) is not a market day, saving a
      // day again does not count twice, and another market's days do not count.
      for (const date of days.slice(1, 10)) await save(date, [samsung]);
      await save('2026-11-14', []);
      await save(days[9], [samsung]);
      await saveKrxDay(
        pool,
        'KOSDAQ',
        days[10],
        [{ symbol: '247540', name: '에코프로비엠', close: '150000' }],
        'FAKE',
        noon,
      );
      assert.equal(await activeOf('000660'), true);

      // The 10th market day without it.
      await save(days[10], [samsung]);
      assert.equal(await activeOf('000660'), false);
      assert.equal(await activeOf('005930'), true);
      await withApi(
        pool,
        async (call) => {
          assert.deepEqual((await call('/api/prices/securities?q=000660')).data.securities, []);
          const id = (
            await pool.query<{ id: string }>("SELECT id FROM securities WHERE symbol = '000660'")
          ).rows[0].id;
          // The detail still opens (holdings will link to it) with the last close and active false.
          const detail = (await call(`/api/prices/securities/${id}`)).data as Detail & {
            security: { active: boolean };
          };
          assert.deepEqual(
            [detail.security.active, detail.quote?.tradeDate],
            [false, '2026-11-02'],
          );
        },
        { today: () => '2026-11-17' },
      );

      // An older day that still had it, saved late (a manual refetch), does not bring it back.
      await save(days[0], [samsung, halted]);
      assert.equal(await activeOf('000660'), false);

      // Back in the data: active again.
      await save(days[11], [samsung, halted]);
      assert.equal(await activeOf('000660'), true);
    },
  );

  await t.test(
    'a security that moved to another market is judged by its new market only',
    async () => {
      await reset();
      const moving = { symbol: '247540', name: '에코프로비엠', close: '150000' };
      const other = { symbol: '005930', name: '삼성전자', close: '70000' };
      const days = [
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-09',
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
        '2026-11-16',
      ];
      await saveKrxDay(
        pool,
        'KOSDAQ',
        days[0],
        [moving, { ...other, symbol: '000250' }],
        'FAKE',
        noon,
      );
      // From the next day it is listed on KOSPI, and KOSDAQ answers keep coming without it.
      for (const date of days.slice(1)) {
        await saveKrxDay(pool, 'KOSPI', date, [moving, other], 'FAKE', noon);
        await saveKrxDay(pool, 'KOSDAQ', date, [{ ...other, symbol: '000250' }], 'FAKE', noon);
      }
      const row = await pool.query<{ market: string; active: boolean }>(
        "SELECT market, active FROM securities WHERE symbol = '247540'",
      );
      assert.deepEqual(row.rows[0], { market: 'KOSPI', active: true });
    },
  );

  await t.test('012 fills market days and last-seen days from closes saved before it', async () => {
    await reset();
    await runDailyFetch(pool, counted().sources, noon, quiet);
    await pool.query('UPDATE securities SET krx_last_seen = NULL');
    await pool.query('DELETE FROM krx_market_days');
    await runMigration(pool, '012_krx_listing.sql');
    const seen = await pool.query("SELECT krx_last_seen FROM securities WHERE symbol = '005930'");
    assert.equal(seen.rows[0].krx_last_seen, '2026-11-06');
    const marketDays = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM krx_market_days WHERE market = 'KOSPI'",
    );
    assert.equal(marketDays.rows[0].n, 6);
    const us = await pool.query("SELECT krx_last_seen FROM securities WHERE symbol = 'AAPL'");
    assert.equal(us.rows[0].krx_last_seen, null);
  });

  await t.test('the DB keeps closes whole for won and in the security currency', async () => {
    await reset();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO securities (market, symbol, name, kind, currency) VALUES ('KOSPI', '005930', '삼성전자', 'stock', 'KRW') RETURNING id",
    );
    const id = rows[0].id;
    await assert.rejects(
      pool.query(
        "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-06', 70000.5, 'KRW', 'T')",
        [id],
      ),
      /security_prices_krw_whole_check/,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-06', 70, 'USD', 'T')",
        [id],
      ),
      /security_prices_security_fkey/,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO securities (market, symbol, kind, currency) VALUES ('NYSE', 'X', 'stock', 'KRW')",
      ),
      /securities_market_currency_check/,
    );
  });
});
