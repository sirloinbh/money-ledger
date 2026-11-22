import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { listen, runMigration, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #184 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();

type Row = {
  line: number;
  date: string;
  kind: string;
  amount: string;
  category?: string;
  merchant?: string;
  memo?: string;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('entry CSV export and import against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let ids: Record<string, number> = {};
  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    ids = Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };
  const add = (
    date: string,
    kind: string,
    amount: number,
    category: number | null,
    merchant = '',
    memo = '',
  ) =>
    pool.query(
      `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [date, kind, amount, category, merchant, memo],
    );
  // Read raw, not as JSON: the export is a CSV file.
  const exported = async (query = '') => {
    const { server, port } = await listen(createApp(pool, { today: () => '2026-11-16' }));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ledger/entries/csv${query}`);
      assert.equal(response.status, 200);
      // ignoreBOM keeps the BOM in the text, so the test can check it is there.
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
        await response.arrayBuffer(),
      );
      return { text, headers: response.headers };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
  const call = async (path: string, body: unknown) => {
    let result: { status: number; data: Record<string, unknown> } | undefined;
    await withApi(pool, async (api) => {
      result = await api(`/api/ledger/entries/csv${path}`, { method: 'POST', body });
    });
    return result!;
  };
  const entries = async () =>
    (
      await pool.query<{ line: string }>(
        `SELECT concat_ws(' ', e.entry_date, e.kind, e.amount, coalesce(c.name, '-'), e.merchant, e.memo) AS line
         FROM ledger_entries e LEFT JOIN ledger_categories c ON c.id = e.category_id
         ORDER BY e.entry_date, e.id`,
      )
    ).rows.map((row) => row.line.trim());

  await t.test('export: BOM, header, oldest first, quoting, formula guard, filters', async () => {
    await reset();
    await add('2026-11-02', 'expense', 12500, ids['expense/식비'], '스타벅스', 'latte, large');
    await add('2026-11-01', 'income', 3000000, ids['income/급여'], 'Company', 'say "hi"');
    await add('2026-11-03', 'expense', 900, null, '=SUM(A1)', 'line\nbreak');
    const { text, headers } = await exported();
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.match(headers.get('content-type') ?? '', /text\/csv; charset=utf-8/);
    assert.match(headers.get('content-disposition') ?? '', /ledger-entries-2026-11-16\.csv/);
    assert.deepEqual(text.slice(1).split('\r\n'), [
      'date,kind,amount,category,merchant,memo',
      '2026-11-01,income,3000000,급여,Company,"say ""hi"""',
      '2026-11-02,expense,12500,식비,스타벅스,"latte, large"',
      `2026-11-03,expense,900,,'=SUM(A1),"line\nbreak"`,
      '',
    ]);
    const income = await exported('?kind=income');
    assert.equal(income.text.slice(1).split('\r\n').length, 3);
  });

  await t.test('preview: every bad row with its line, and likely duplicates', async () => {
    await reset();
    await add('2026-11-02', 'expense', 12500, ids['expense/식비'], '스타벅스');
    await pool.query('UPDATE ledger_categories SET hidden = true WHERE id = $1', [
      ids['expense/기타'],
    ]);
    const rows: Row[] = [
      { line: 2, date: '2026-11-02', kind: 'expense', amount: '12500', merchant: '스타벅스' },
      { line: 3, date: '2026-02-30', kind: 'expense', amount: '1' },
      { line: 4, date: '2026-11-03', kind: 'spend', amount: '1' },
      { line: 5, date: '2026-11-03', kind: 'expense', amount: '1.5' },
      { line: 6, date: '2026-11-03', kind: 'expense', amount: '1', category: '없는것' },
      { line: 7, date: '2026-11-03', kind: 'expense', amount: '1', category: '기타' },
      { line: 8, date: '2026-11-03', kind: 'income', amount: '1', category: '식비' },
      {
        line: 9,
        date: '2026-11-03',
        kind: 'expense',
        amount: '1',
        category: '식비',
        merchant: 'x'.repeat(51),
      },
      { line: 10, date: '2026-11-02', kind: 'expense', amount: '12500', merchant: '이마트' },
      // #186 One won over the cap.
      { line: 11, date: '2026-11-03', kind: 'expense', amount: '1,000,000,000,001' },
    ];
    const preview = await call('/preview', { rows });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.deepEqual(
      (preview.data.problems as { line: number }[]).map((problem) => problem.line),
      [3, 4, 5, 6, 7, 8, 9, 11],
    );
    assert.match(
      (preview.data.problems as { message: string }[])[0].message,
      /Date "2026-02-30": That date does not exist/,
    );
    assert.deepEqual(preview.data.duplicates, [2]);
    assert.match(
      (preview.data.problems as { message: string }[]).at(-1)!.message,
      /Amount "1,000,000,000,001" is not a whole number of won from 0 to ₩1 trillion/,
    );
    assert.deepEqual([preview.data.rows, preview.data.valid], [10, 2]);
  });

  await t.test('import: one bad row saves nothing', async () => {
    await reset();
    const response = await call('/import', {
      rows: [
        { line: 2, date: '2026-11-01', kind: 'expense', amount: '1000' },
        { line: 3, date: 'yesterday', kind: 'expense', amount: '1000' },
      ],
    });
    assert.equal(response.status, 422);
    assert.equal(response.data.error, '1 row(s) cannot be imported. Nothing was saved');
    assert.deepEqual(
      (response.data.problems as { line: number }[]).map((p) => p.line),
      [3],
    );
    assert.deepEqual(await entries(), []);
  });

  await t.test(
    'import: categories by name, rules for empty ones, duplicates skipped or kept',
    async () => {
      await reset();
      await pool.query(
        `INSERT INTO ledger_category_rules (keyword, kind, category_id) VALUES ('스타벅스', 'expense', $1)`,
        [ids['expense/식비']],
      );
      await add('2026-11-02', 'expense', 12500, ids['expense/식비'], '스타벅스');
      const rows: Row[] = [
        { line: 2, date: '2026-11-02', kind: 'expense', amount: '12500', merchant: '스타벅스' },
        { line: 3, date: '2026-11-03', kind: 'expense', amount: '4500', merchant: '스타벅스 강남' },
        {
          line: 4,
          date: '2026-11-04',
          kind: 'income',
          amount: '3000000',
          category: '급여',
          memo: ' 11월 ',
        },
      ];
      const skipped = await call('/import', { rows, skipDuplicates: true });
      assert.equal(skipped.status, 200, JSON.stringify(skipped.data));
      assert.deepEqual(skipped.data, { imported: 2, skipped: 1 });
      assert.deepEqual(await entries(), [
        '2026-11-02 expense 12500 식비 스타벅스',
        '2026-11-03 expense 4500 식비 스타벅스 강남',
        '2026-11-04 income 3000000 급여  11월',
      ]);
      // Kept on request: the same row is saved again.
      const kept = await call('/import', { rows: [rows[0]], skipDuplicates: false });
      assert.deepEqual(kept.data, { imported: 1, skipped: 0 });
      assert.equal((await entries()).length, 4);
    },
  );

  await t.test('an exported file imports back as the same entries', async () => {
    await reset();
    await add('2026-11-02', 'expense', 12500, ids['expense/식비'], '스타벅스', 'latte, large');
    await add('2026-11-01', 'income', 3000000, ids['income/급여'], 'Company', 'say "hi"');
    // Exported with a leading ' so Excel does not run them, and imported back without it.
    await add('2026-11-03', 'expense', 1, null, '+Cafe', '@home');
    const before = await entries();
    const { text } = await exported();
    // A tiny CSV reader for this file: quoted fields with doubled quotes, no line breaks inside.
    const parse = (line: string) =>
      [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)]
        .slice(0, 6)
        .map(([, field]) =>
          field.startsWith('"') ? field.slice(1, -1).replaceAll('""', '"') : field,
        );
    const rows = text
      .slice(1)
      .split('\r\n')
      .slice(1, -1)
      .map((line, index) => {
        const [date, kind, amount, category, merchant, memo] = parse(line);
        return { line: index + 2, date, kind, amount, category, merchant, memo };
      });
    await pool.query('DELETE FROM ledger_entries');
    const response = await call('/import', { rows });
    assert.deepEqual(response.data, { imported: 3, skipped: 0 });
    assert.deepEqual(await entries(), before);
  });

  await t.test(
    'a repeated or out-of-range line number is refused, nothing saved (#200)',
    async () => {
      await reset();
      // Line 2 matches an existing entry; the other row with line 2 does not and must not be dropped.
      await add('2026-11-02', 'expense', 12500, ids['expense/식비'], '스타벅스');
      const repeated = [
        { line: 2, date: '2026-11-02', kind: 'expense', amount: '12500', merchant: '스타벅스' },
        { line: 2, date: '2026-11-05', kind: 'expense', amount: '700', merchant: '편의점' },
      ];
      for (const path of ['/preview', '/import']) {
        const response = await call(path, { rows: repeated });
        assert.equal(response.status, 400, path);
        assert.equal(response.data.error, 'Each row must have its own line number');
      }
      const huge = await call('/preview', {
        rows: [{ line: 2 ** 31, date: '2026-11-05', kind: 'expense', amount: '1' }],
      });
      assert.equal(huge.status, 400);
      assert.equal(huge.data.error, 'A line number must be 2147483647 or less');
      assert.equal((await entries()).length, 1);
    },
  );

  await t.test(
    'export with uncategorized=true has only entries without a category (#200)',
    async () => {
      await reset();
      await add('2026-11-02', 'expense', 12500, ids['expense/식비'], 'Cafe');
      await add('2026-11-03', 'expense', 700, null, 'Shop');
      const lines = (await exported('?uncategorized=true')).text.slice(1).split('\r\n');
      assert.deepEqual(lines, [
        'date,kind,amount,category,merchant,memo',
        '2026-11-03,expense,700,,Shop,',
        '',
      ]);
    },
  );

  await t.test('2,000 rows fit; more are refused', async () => {
    await reset();
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        line: index + 2,
        date: '2026-11-01',
        kind: 'expense',
        amount: String(index + 1),
        merchant: `상점 ${index}`,
        memo: '메모'.repeat(50),
      }));
    const ok = await call('/import', { rows: many(2000) });
    assert.equal(ok.status, 200, JSON.stringify(ok.data).slice(0, 200));
    assert.deepEqual(ok.data, { imported: 2000, skipped: 0 });
    const tooMany = await call('/preview', { rows: many(2001) });
    assert.equal(tooMany.status, 400);
  });
});
