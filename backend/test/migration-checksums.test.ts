import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readMigrations } from '../src/standard/migrations.js';

// #180: the runner refuses to start when an applied file's checksum differs from schema_migrations, which would
// stop every deploy at the migration step. These are the checksums every DB recorded (the runner and its history
// arrived in #71 on 2026-11-16; the files have not changed since). Never edit a file listed here; add a new one.
// When a new migration ships, add its line. A file numbered above the last pinned one may stay unpinned until then.
const pinned: Record<string, string> = {
  '001_initial.sql': '697285e2685a1a3b6e7385a7c8e4d40363b12314dc6e4dcb298ce85c78325067',
  '002_ledger_categories.sql': 'b40fd640d7065a0aa444e24a5b382cfa41765e42410aa795bbfb61b8bba1c82b',
  '003_ledger_entries.sql': '169a18616c08130b9acc549900e7270ed0c3a7d8ee2ef95d4d5832e94edc0cd5',
  '004_portfolio_assets.sql': '42ed58fc6af3ac1e6aea90903600acfd7c488df5caf5b32ec8bbd877f020652b',
  '005_mock_accounts.sql': '33872c990b9c77029a267eb4092166b7f25a5d6e8a92f364c2167ded00398fb0',
  '006_ledger_classification.sql':
    'a381f726c8d4dcf6edf1b7e2a0d12f6f174eebe449f73e04a256319f02088f69',
  '007_depreciable_assets.sql': '727d2b31c16435fdfccc7c6fbcd3910d4441f27ff0dd64e917b67ccd24e550b0',
  '009_prices.sql': '477d58edfb4f17e858af23a1f2cd311a2b0530dd05d9e0a713ff940c4cc46fea',
  '010_prepaid_assets.sql': 'dab4eef8a5c65319df2dbb9a9e55d9d1b35dc1040830f1fab52321965806e8a8',
  '012_krx_listing.sql': '59c00cd578fddebc5ab6757cff94d6e63b579312287e2ff86797db9d1b14b308',
  '013_asset_trades.sql': '14ed4774f55c678b8c323c705e1294a37eb3d135c305b9b7fec2a03c89ff69c0',
  '015_mock_orders.sql': '974369538437086a86bc730b276880396e645b4ced0c0f5121bb377aa1f57e83',
  '016_asset_valuation.sql': 'b1d2ad394873f931e329b279a708d82a4d4e5396fffb97d880e1fc61176655e7',
  '017_ledger_budgets.sql': '3e716eea7c3afef426fdcf485e580c9ebe01198800d8a6dded7e221264a8d58f',
  '018_mock_snapshots.sql': '43c04f583b2ffb8954bc30d3cead01135fe318cc08c79814945389a20d7ef67f',
  '019_net_worth_snapshots.sql': 'cec5c097edcec97f12d5fef4e52a14e88b2162f9b1c8edadd73ec30c27de4f36',
  '020_ledger_fixed_costs.sql': 'af8acb189cfa0468010a2132aa372dee482ac45460f4191d1567d975017c9c29',
  '021_spending_reports.sql': '3ac20d99d6f9fcdc2020cb35b2e9ef3c5c98b334192fdc51476b609db2896154',
  '022_audit_log.sql': '899793c531c4989cb85be872976c67a0ab17477625ccceb7cea84f94c537adfb',
  '023_trade_currency_fk.sql': '697a88201dee4131af5daaea64a2fed9f8b81b2dfc181200370e27ebb1b90732',
  '024_price_fetch_not_found.sql':
    'c30338351d468b4748d79acadb275779f2450fdd11ee555fed2b50a9f387f3d0',
};

const dir = fileURLToPath(new URL('../../database/migrations/', import.meta.url));

test('no applied migration file changed since its checksum was recorded (#180)', async () => {
  const files = new Map((await readMigrations(dir)).map((file) => [file.name, file.checksum]));
  for (const [name, checksum] of Object.entries(pinned)) {
    assert.ok(files.has(name), `${name} was removed or renamed; an applied migration must stay`);
    assert.equal(
      files.get(name),
      checksum,
      `${name} changed after it was applied; restore it and put the change in a new migration`,
    );
  }
});

test('every migration up to the last pinned one is pinned (#180)', async () => {
  const last = Object.keys(pinned).sort().at(-1)!;
  const unpinned = (await readMigrations(dir))
    .map((file) => file.name)
    .filter((name) => name <= last && !(name in pinned));
  assert.deepEqual(
    unpinned,
    [],
    'a file was added below an applied one, or is missing from the list',
  );
});
