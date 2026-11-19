// Managed file. Edit it in sirloinbh/project-standards templates/app/scripts/test/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { copies, diffContract, hasContract } from '../contract.mjs';

test('repository contract copies match shared/contract.ts', () => {
  assert.deepEqual(diffContract(), []);
  assert.equal(copies.length, 2);
});

test('an app without shared/contract.ts has nothing to check (ADR-0026)', () => {
  const missing = path.join(os.tmpdir(), 'no-such-contract', 'contract.ts');
  assert.equal(hasContract(missing), false);
  assert.deepEqual(diffContract(missing, copies), []);
});

test('a changed or missing copy is reported, line endings are ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  try {
    const from = path.join(dir, 'source.ts');
    const same = path.join(dir, 'same.ts');
    const changed = path.join(dir, 'changed.ts');
    const missing = path.join(dir, 'missing.ts');
    // Self-contained: an app without shared/contract.ts (ADR-0026) runs this test too.
    const text = 'export const sample = 1;\n';
    fs.writeFileSync(from, text);
    fs.writeFileSync(same, text.replace(/\n/g, '\r\n'));
    fs.writeFileSync(changed, text + '// edited copy\n');
    const stale = diffContract(from, [same, changed, missing]).map((f) => path.basename(f));
    assert.deepEqual(stale, ['changed.ts', 'missing.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
