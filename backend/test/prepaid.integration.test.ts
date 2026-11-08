import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Asset = {
  id: number;
  prepaid: {
    kind: 'amount' | 'period';
    amountKrw: number;
    startsOn: string | null;
    expiresOn: string | null;
    usedKrw: number;
  } | null;
  currentValueKrw: number | null;
};
type Usage = { id: number; usedOn: string; amountKrw: number; memo: string };

const path = '/api/portfolio/assets';
// Decisions (2026-11-08): a stored value loses what is used; a pass keeps round(paid × days left ÷ all days).
const salon = {
  name: '미용실 회원권',
  type: 'prepaid',
  currency: 'KRW',
  prepaid: { kind: 'amount', amountKrw: 300_000 },
};
const gym = {
  name: '헬스장 3개월',
  type: 'prepaid',
  currency: 'KRW',
  // 2026-01-01 to 2026-03-31: 90 days, both ends included.
  prepaid: { kind: 'period', amountKrw: 270_000, startsOn: '2026-01-01', expiresOn: '2026-03-31' },
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('prepaid assets against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('DROP TABLE IF EXISTS portfolio_prepaid_usages, portfolio_assets');
    for (const file of ['004_portfolio_assets.sql', '007_depreciable_assets.sql']) {
      await runMigration(pool, file);
    }
    await runMigration(pool, '010_prepaid_assets.sql');
    await runMigration(pool, '010_prepaid_assets.sql'); // re-running is safe
  };

  await t.test(
    'a period pass loses value by the day and is 0 the day after it expires',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const created = await call(path, { method: 'POST', body: gym });
        assert.equal(created.status, 201);
        assert.deepEqual((created.data.asset as Asset).prepaid, {
          kind: 'period',
          amountKrw: 270_000,
          startsOn: '2026-01-01',
          expiresOn: '2026-03-31',
          usedKrw: 0,
        });
        const valueOn = async (asOf: string) =>
          ((await call(`${path}?asOf=${asOf}`)).data.assets as Asset[])[0].currentValueKrw;
        assert.equal(await valueOn('2025-12-31'), 270_000); // before the start
        assert.equal(await valueOn('2026-01-01'), 270_000); // all 90 days left
        assert.equal(await valueOn('2026-01-02'), 267_000); // 89 days
        assert.equal(await valueOn('2026-02-15'), 135_000); // 45 days
        assert.equal(await valueOn('2026-03-31'), 3_000); // the last usable day
        assert.equal(await valueOn('2026-04-01'), 0); // expired
      });
    },
  );

  await t.test('a period pass rounds half away from zero', async () => {
    await reset();
    await withApi(pool, async (call) => {
      // 5 won over 2 days: 2.5 won left on the last day, rounded to 3 (half-even would give 2).
      await call(path, {
        method: 'POST',
        body: {
          ...gym,
          prepaid: {
            ...gym.prepaid,
            amountKrw: 5,
            startsOn: '2026-01-01',
            expiresOn: '2026-01-02',
          },
        },
      });
      const { data } = await call(`${path}?asOf=2026-01-02`);
      assert.equal((data.assets as Asset[])[0].currentValueKrw, 3);
    });
  });

  await t.test(
    'a stored value goes down with each use and a use above the balance is refused',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const { data } = await call(path, { method: 'POST', body: salon });
        const id = (data.asset as Asset).id;
        const use = (body: object) => call(`${path}/${id}/usages`, { method: 'POST', body });

        const first = await use({ usedOn: '2026-02-01', amountKrw: 50_000, memo: ' 커트 ' });
        assert.equal(first.status, 201);
        assert.deepEqual(
          { ...(first.data.usage as Usage), id: 0 },
          {
            id: 0,
            usedOn: '2026-02-01',
            amountKrw: 50_000,
            memo: '커트',
          },
        );
        assert.equal((await use({ usedOn: '2026-03-01', amountKrw: 200_000 })).status, 201);

        const over = await use({ usedOn: '2026-03-02', amountKrw: 50_001 });
        assert.equal(over.status, 400);
        assert.deepEqual(over.data, { error: '잔액보다 많이 쓸 수 없습니다(남은 금액 50,000원)' });
        assert.equal((await use({ usedOn: '2026-03-02', amountKrw: 50_000 })).status, 201); // exactly the rest

        const valueOn = async (asOf: string) =>
          ((await call(`${path}?asOf=${asOf}`)).data.assets as Asset[])[0];
        assert.equal((await valueOn('2026-01-31')).currentValueKrw, 300_000); // before any use
        assert.equal((await valueOn('2026-02-15')).currentValueKrw, 250_000);
        assert.equal((await valueOn('2026-02-15')).prepaid?.usedKrw, 50_000);
        assert.equal((await valueOn('2026-03-02')).currentValueKrw, 0);

        const list = await call(`${path}/${id}/usages`);
        assert.deepEqual(
          (list.data.usages as Usage[]).map((usage) => usage.usedOn),
          ['2026-03-02', '2026-03-01', '2026-02-01'], // newest first
        );
      });
    },
  );

  await t.test('two uses at the same time cannot both spend the last of the balance', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const { data } = await call(path, {
        method: 'POST',
        body: { ...salon, prepaid: { kind: 'amount', amountKrw: 10_000 } },
      });
      const id = (data.asset as Asset).id;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(`${path}/${id}/usages`, {
            method: 'POST',
            body: { usedOn: '2026-02-01', amountKrw: 10_000 },
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400, 400, 400, 400]);
    });
  });

  await t.test('a stored value with an expiry is 0 after it and refuses later uses', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const { data } = await call(path, {
        method: 'POST',
        body: {
          ...salon,
          prepaid: { kind: 'amount', amountKrw: 100_000, expiresOn: '2026-06-30' },
        },
      });
      const id = (data.asset as Asset).id;
      const valueOn = async (asOf: string) =>
        ((await call(`${path}?asOf=${asOf}`)).data.assets as Asset[])[0].currentValueKrw;
      assert.equal(await valueOn('2026-06-30'), 100_000);
      assert.equal(await valueOn('2026-07-01'), 0);
      const late = await call(`${path}/${id}/usages`, {
        method: 'POST',
        body: { usedOn: '2026-07-01', amountKrw: 1 },
      });
      assert.equal(late.status, 400);
      assert.deepEqual(late.data, { error: '만료일(2026-06-30)이 지난 날짜에는 쓸 수 없습니다' });
    });
  });

  await t.test('the current value counts in the totals as a whole won amount', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        await call(path, { method: 'POST', body: gym });
        const { data } = await call(path, { method: 'POST', body: salon });
        await call(`${path}/${(data.asset as Asset).id}/usages`, {
          method: 'POST',
          body: { usedOn: '2026-02-01', amountKrw: 30_000 },
        });
        const list = await call(path);
        assert.equal(list.data.asOf, '2026-02-15');
        // 45 of 90 days left: 135,000; 300,000 - 30,000 = 270,000.
        assert.deepEqual(list.data.totals, {
          assetsKrw: 405_000,
          debtsKrw: 0,
          netKrw: 405_000,
          uncounted: 0,
        });
      },
      { today: () => '2026-02-15' },
    );
  });

  await t.test(
    'uses are only for stored values, can be deleted, and go with their asset',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const pass = await call(path, { method: 'POST', body: gym });
        const passUse = await call(`${path}/${(pass.data.asset as Asset).id}/usages`, {
          method: 'POST',
          body: { usedOn: '2026-01-05', amountKrw: 1 },
        });
        assert.equal(passUse.status, 400);
        assert.deepEqual(passUse.data, { error: '사용 기록은 선입금 금액권에만 넣을 수 있습니다' });

        const { data } = await call(path, { method: 'POST', body: salon });
        const id = (data.asset as Asset).id;
        const created = await call(`${path}/${id}/usages`, {
          method: 'POST',
          body: { usedOn: '2026-02-01', amountKrw: 1000 },
        });
        const usageId = (created.data.usage as Usage).id;
        // The use belongs to this asset only.
        const elsewhere = await call(`${path}/${(pass.data.asset as Asset).id}/usages/${usageId}`, {
          method: 'DELETE',
        });
        assert.equal(elsewhere.status, 404);
        assert.equal(
          (await call(`${path}/${id}/usages/${usageId}`, { method: 'DELETE' })).status,
          204,
        );
        const again = await call(`${path}/${id}/usages/${usageId}`, { method: 'DELETE' });
        assert.deepEqual(again.data, { error: '사용 기록을 찾을 수 없습니다' });

        await call(`${path}/${id}/usages`, {
          method: 'POST',
          body: { usedOn: '2026-02-02', amountKrw: 1000 },
        });
        assert.equal((await call(`${path}/${id}`, { method: 'DELETE' })).status, 204);
        const left = await pool.query('SELECT count(*)::int AS n FROM portfolio_prepaid_usages');
        assert.equal(left.rows[0].n, 0);
        assert.equal((await call(`${path}/${id}/usages`)).status, 404);
      });
    },
  );

  await t.test(
    'an asset with uses keeps its stored value and cannot drop below what was used',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const { data } = await call(path, { method: 'POST', body: salon });
        const id = (data.asset as Asset).id;
        await call(`${path}/${id}/usages`, {
          method: 'POST',
          body: { usedOn: '2026-02-01', amountKrw: 120_000 },
        });
        const put = (body: object) => call(`${path}/${id}`, { method: 'PUT', body });

        const toPass = await put(gym);
        assert.equal(toPass.status, 400);
        assert.deepEqual(toPass.data, {
          error:
            '사용 기록이 있는 금액권은 금액권으로만 바꿀 수 있습니다. 사용 기록을 먼저 지우세요',
        });
        const tooSmall = await put({ ...salon, prepaid: { kind: 'amount', amountKrw: 119_999 } });
        assert.deepEqual(tooSmall.data, {
          error: '결제액은 이미 쓴 금액(120,000원)보다 적을 수 없습니다',
        });
        const renamed = await put({
          ...salon,
          name: '미용실',
          prepaid: { kind: 'amount', amountKrw: 400_000 },
        });
        assert.equal(renamed.status, 200);
        assert.equal((renamed.data.asset as Asset).currentValueKrw, 280_000);
        const missing = await call(`${path}/999999`, { method: 'PUT', body: salon });
        assert.equal(missing.status, 404);
        assert.deepEqual(missing.data, { error: '자산을 찾을 수 없습니다' });
      });
    },
  );

  await t.test('the DB refuses a prepaid row that does not add up', async () => {
    await reset();
    const insert = (columns: string, values: string) =>
      pool.query(
        `INSERT INTO portfolio_assets (name, asset_type, ${columns}) VALUES ('a', ${values})`,
      );
    // A pass without dates, a pass that ends before it starts, a stored value with a start, a prepaid row
    // with a hand-entered value, and prepaid fields on another type.
    await assert.rejects(insert('prepaid_kind, prepaid_amount_krw', "'prepaid', 'period', 1"), {
      code: '23514',
    });
    await assert.rejects(
      insert(
        'prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on',
        "'prepaid', 'period', 1, '2026-02-01', '2026-01-31'",
      ),
      { code: '23514' },
    );
    await assert.rejects(
      insert(
        'prepaid_kind, prepaid_amount_krw, prepaid_starts_on',
        "'prepaid', 'amount', 1, '2026-01-01'",
      ),
      { code: '23514' },
    );
    await assert.rejects(
      insert('prepaid_kind, prepaid_amount_krw, value_krw', "'prepaid', 'amount', 1, 1"),
      { code: '23514' },
    );
    await assert.rejects(insert('prepaid_kind, prepaid_amount_krw', "'cash', 'amount', 1"), {
      code: '23514',
    });
  });
});
