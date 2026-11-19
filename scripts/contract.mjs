// Managed file. Edit it in sirloinbh/project-standards templates/app/scripts/
// Copies the shared input contract (source of truth: shared/contract.ts) into the
// backend and frontend so each area still builds alone (Docker contexts, subtree repos).
// `node scripts/contract.mjs sync` writes the copies; without arguments it only checks.
// The contract is opt-in (ADR-0026): an app without shared/contract.ts has nothing to copy or check, and both commands exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const source = path.join(root, 'shared/contract.ts');
export const copies = ['backend/src/contract.ts', 'frontend/src/contract.ts'].map((file) =>
  path.join(root, file),
);
// Git may check files out with CRLF on Windows; compare text by content.
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

export const hasContract = (from = source) => fs.existsSync(from);

export function diffContract(from = source, to = copies) {
  if (!hasContract(from)) return [];
  const expected = read(from);
  return to
    .filter((file) => !fs.existsSync(file) || read(file) !== expected)
    .map((file) => path.relative(root, file).split(path.sep).join('/'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!hasContract()) {
    console.log('No shared/contract.ts: the app does not use the shared contract.');
  } else if (process.argv[2] === 'sync') {
    for (const file of copies) fs.copyFileSync(source, file);
    console.log('Copied shared/contract.ts to backend/src and frontend/src.');
  } else {
    const stale = diffContract();
    if (stale.length) {
      console.error(
        `Out of sync with shared/contract.ts: ${stale.join(', ')}. Run npm run contract:sync.`,
      );
      process.exit(1);
    }
    console.log('Contract copies match shared/contract.ts.');
  }
}
