import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checksum, type Migration, planMigrations, readMigrations } from '../src/migrations.js';

const file = (name: string, sql = 'SELECT 1'): Migration => ({
  name,
  sql,
  checksum: checksum(sql),
});
const row = ({ name, checksum: sum }: Migration) => ({ name, checksum: sum });

test('the checksum ignores line endings and a BOM, not the content', () => {
  assert.equal(checksum('A\nB'), checksum('A\r\nB'));
  assert.equal(checksum('A'), checksum(String.fromCharCode(0xfeff) + 'A'));
  assert.notEqual(checksum('A'), checksum('B'));
});

test('only files not yet applied are pending, in order', () => {
  const [one, two, three] = [file('001_a.sql'), file('002_b.sql'), file('003_c.sql')];
  assert.deepEqual(planMigrations([one, two, three], [row(one)]), {
    pending: [two, three],
    errors: [],
  });
  assert.deepEqual(planMigrations([one], [row(one)]), { pending: [], errors: [] });
});

test('history that no longer matches the files is refused', () => {
  const one = file('001_a.sql');
  const changed = file('001_a.sql', 'SELECT 2');
  assert.match(planMigrations([], [row(one)]).errors[0], /file is missing: 001_a\.sql/);
  assert.match(planMigrations([changed], [row(one)]).errors[0], /was changed: 001_a\.sql/);
});

test('a new file sorted before an applied one is refused', () => {
  const [one, two] = [file('001_a.sql'), file('002_b.sql')];
  assert.match(planMigrations([one, two], [row(two)]).errors[0], /New file numbered before/);
});

test('reading a folder sorts files and refuses bad names and duplicate numbers', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
  t.after(() => rm(dir, { recursive: true }));
  await writeFile(join(dir, '002_b.sql'), 'SELECT 2');
  await writeFile(join(dir, '001_a.sql'), 'SELECT 1');
  await writeFile(join(dir, 'README.txt'), 'not a migration');
  assert.deepEqual(
    (await readMigrations(dir)).map((migration) => migration.name),
    ['001_a.sql', '002_b.sql'],
  );

  await writeFile(join(dir, '002_c.sql'), 'SELECT 3');
  await assert.rejects(readMigrations(dir), /Duplicate migration number: 002_b\.sql, 002_c\.sql/);
  await rm(join(dir, '002_c.sql'));

  await writeFile(join(dir, '3-bad.sql'), 'SELECT 3');
  await assert.rejects(
    readMigrations(dir),
    /Migration file names must look like NNN_name\.sql: 3-bad\.sql/,
  );
});
