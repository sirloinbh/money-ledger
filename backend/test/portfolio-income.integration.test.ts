import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #295 Dividends, interest, realized gains and the overseas tax estimate against the real database.
// Skipped (not passed) without TEST_DATABASE_URL.
const url = await testDatabase();

type Call = Parameters<Parameters<typeof withApi>[1]>[0];
type Summary = {
  year: number;
  years: number[];
  income: { id: number; kind: string; amountKrw: number; amountForeign: string | null }[];
  incomeTotals: {
    dividendKrw: number;
    interestKrw: number;
    financialIncomeKrw: number;
    taxWithheldKrw: number;
    overLine: boolean;
  };
  gains: {
    overseasKrw: number;
    domesticKrw: number;
    sales: { assetName: string; tradedOn: string; currency: string; realizedKrw: number }[];
  };
  overseasTax: {
    gainKrw: number;
    deductionKrw: number;
    taxableKrw: number;
    percent: number;
    estimateKrw: number;
  };
};

const assets = '/api/portfolio/assets';

test(
  'income, realized gains and the tax estimate against the real database',
  { skip: !url },
  async (t) => {
    const pool = new Pool({ connectionString: url });
    t.after(() => pool.end());

    const asset = async (call: Call, name: string, currency: 'KRW' | 'USD') =>
      (
        (
          await call(assets, {
            method: 'POST',
            body: { name, type: 'stock', currency, quantity: '1' },
          })
        ).data.asset as { id: number }
      ).id;
    const trade = async (call: Call, id: number, body: object) => {
      const response = await call(`${assets}/${id}/trades`, { method: 'POST', body });
      assert.equal(response.status, 201, JSON.stringify(response.data));
    };
    const summary = async (call: Call, year?: number) => {
      const response = await call(`/api/portfolio/income${year ? `?year=${year}` : ''}`);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      return response.data as unknown as Summary;
    };
    const run = (fn: (call: Call) => Promise<void>) =>
      withApi(pool, fn, { today: () => '2026-11-26' });

    await t.test(
      'a gain above the deduction is taxed at 22% of the rest; domestic sales stay out of it',
      async () => {
        await resetDatabase(pool);
        await run(async (call) => {
          const apple = await asset(call, 'Apple', 'USD');
          // 10 @ $100 and 10 @ $200 at 1,000 won: moving average 150,000 won a share.
          await trade(call, apple, {
            side: 'buy',
            tradedOn: '2026-01-05',
            quantity: '10',
            price: '100',
            fxRate: '1000',
          });
          await trade(call, apple, {
            side: 'buy',
            tradedOn: '2026-02-05',
            quantity: '10',
            price: '200',
            fxRate: '1000',
          });
          // Sell 10 @ $500: 5,000,000 - 1,500,000 = 3,500,000.
          await trade(call, apple, {
            side: 'sell',
            tradedOn: '2026-06-01',
            quantity: '10',
            price: '500',
            fxRate: '1000',
          });
          const samsung = await asset(call, 'Samsung', 'KRW');
          await trade(call, samsung, {
            side: 'buy',
            tradedOn: '2026-01-05',
            quantity: '10',
            price: '1000',
          });
          await trade(call, samsung, {
            side: 'sell',
            tradedOn: '2026-03-05',
            quantity: '5',
            price: '1500',
          });
          const result = await summary(call);
          assert.equal(result.year, 2026);
          assert.equal(result.gains.overseasKrw, 3_500_000);
          assert.equal(result.gains.domesticKrw, 2_500);
          assert.equal(result.gains.sales.length, 2);
          assert.deepEqual(result.overseasTax, {
            gainKrw: 3_500_000,
            deductionKrw: 2_500_000,
            taxableKrw: 1_000_000,
            percent: 22,
            estimateKrw: 220_000,
          });
        });
      },
    );

    await t.test(
      'a gain under the deduction and a loss owe nothing; years are separate',
      async () => {
        await resetDatabase(pool);
        await run(async (call) => {
          const apple = await asset(call, 'Apple', 'USD');
          const tesla = await asset(call, 'Tesla', 'USD');
          await trade(call, apple, {
            side: 'buy',
            tradedOn: '2025-01-05',
            quantity: '10',
            price: '100',
            fxRate: '1000',
          });
          // 2025: sell 10 @ $120 = +200,000, under the deduction.
          await trade(call, apple, {
            side: 'sell',
            tradedOn: '2025-12-31',
            quantity: '5',
            price: '120',
            fxRate: '1000',
          });
          // 2026: a gain on Apple (+1,000,000) and a loss on Tesla (-1,500,000) offset each other: -500,000.
          await trade(call, apple, {
            side: 'sell',
            tradedOn: '2026-01-02',
            quantity: '5',
            price: '300',
            fxRate: '1000',
          });
          await trade(call, tesla, {
            side: 'buy',
            tradedOn: '2026-01-03',
            quantity: '10',
            price: '200',
            fxRate: '1000',
          });
          await trade(call, tesla, {
            side: 'sell',
            tradedOn: '2026-02-03',
            quantity: '10',
            price: '50',
            fxRate: '1000',
          });
          const y2025 = await summary(call, 2025);
          assert.equal(y2025.gains.overseasKrw, 100_000);
          assert.equal(y2025.overseasTax.taxableKrw, 0);
          assert.equal(y2025.overseasTax.estimateKrw, 0);
          const y2026 = await summary(call, 2026);
          assert.equal(y2026.gains.overseasKrw, 1_000_000 - 1_500_000);
          assert.equal(y2026.overseasTax.estimateKrw, 0);
          assert.deepEqual(y2026.years, [2026, 2025]);
          assert.equal((await call('/api/portfolio/income?year=26')).status, 400);
        });
      },
    );

    await t.test(
      'dividends and interest are saved in won, a dollar receipt rounds once',
      async () => {
        await resetDatabase(pool);
        await run(async (call) => {
          const apple = await asset(call, 'Apple', 'USD');
          const bank = await asset(call, 'Bond fund', 'KRW');
          const dollar = await call('/api/portfolio/income', {
            method: 'POST',
            body: {
              assetId: apple,
              kind: 'dividend',
              receivedOn: '2026-05-15',
              amountForeign: '12.3456',
              fxRate: '1385.2500',
              taxWithheldKrw: 2_000,
              memo: ' Q1 ',
            },
          });
          assert.equal(dollar.status, 201, JSON.stringify(dollar.data));
          // 12.3456 x 1385.25 = 17,101.7424, rounded once to 17,102
          const saved = dollar.data.income as { amountKrw: number; memo: string; fxRate: string };
          assert.equal(saved.amountKrw, 17_102);
          assert.equal(saved.memo, 'Q1');
          assert.equal(saved.fxRate, '1385.2500');
          const won = await call('/api/portfolio/income', {
            method: 'POST',
            body: {
              assetId: bank,
              kind: 'interest',
              receivedOn: '2026-06-01',
              amountKrw: 20_000_000,
            },
          });
          assert.equal(won.status, 201, JSON.stringify(won.data));
          const result = await summary(call);
          assert.equal(result.income.length, 2);
          assert.equal(result.incomeTotals.dividendKrw, 17_102);
          assert.equal(result.incomeTotals.interestKrw, 20_000_000);
          assert.equal(result.incomeTotals.financialIncomeKrw, 20_017_102);
          assert.equal(result.incomeTotals.taxWithheldKrw, 2_000);
          assert.equal(result.incomeTotals.overLine, true);
          // Another year does not count it.
          assert.equal((await summary(call, 2025)).incomeTotals.financialIncomeKrw, 0);
        });
      },
    );

    await t.test('a bad receipt is refused and a record can be deleted once', async () => {
      await resetDatabase(pool);
      await run(async (call) => {
        const apple = await asset(call, 'Apple', 'USD');
        const bank = await asset(call, 'Bond fund', 'KRW');
        const post = (body: object) => call('/api/portfolio/income', { method: 'POST', body });
        const base = { kind: 'dividend', receivedOn: '2026-05-15' };
        assert.equal((await post({ ...base, assetId: bank })).status, 400, 'won without amount');
        assert.equal(
          (await post({ ...base, assetId: bank, amountKrw: 100, fxRate: '1300.0000' })).status,
          400,
          'won with a rate',
        );
        assert.equal((await post({ ...base, assetId: apple, amountForeign: '5' })).status, 400);
        assert.equal(
          (await post({ ...base, assetId: bank, amountKrw: 100, taxWithheldKrw: 101 })).status,
          400,
          'withheld more than the amount',
        );
        assert.equal(
          (await post({ ...base, assetId: bank, amountKrw: 100, receivedOn: '2026-11-27' })).status,
          400,
          'after today',
        );
        assert.equal((await post({ ...base, assetId: bank, amountKrw: 1.5 })).status, 400);
        assert.equal((await post({ ...base, assetId: 9999, amountKrw: 100 })).status, 404);
        assert.equal((await summary(call)).income.length, 0);
        const ok = await post({ ...base, assetId: bank, amountKrw: 100 });
        const id = (ok.data.income as { id: number }).id;
        assert.equal((await call(`/api/portfolio/income/${id}`, { method: 'DELETE' })).status, 204);
        assert.equal((await call(`/api/portfolio/income/${id}`, { method: 'DELETE' })).status, 404);
      });
    });

    await t.test('deleting a holding removes its income records', async () => {
      await resetDatabase(pool);
      await run(async (call) => {
        const bank = await asset(call, 'Bond fund', 'KRW');
        await call('/api/portfolio/income', {
          method: 'POST',
          body: { assetId: bank, kind: 'interest', receivedOn: '2026-06-01', amountKrw: 500 },
        });
        assert.equal((await call(`${assets}/${bank}`, { method: 'DELETE' })).status, 204);
        assert.equal((await summary(call)).income.length, 0);
      });
    });
  },
);
