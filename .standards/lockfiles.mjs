// Managed file. Edit it in sirloinbh/project-standards scripts/
// Checks that frontend/ and backend/ lockfiles pin the same versions as the root lockfile, and rewrites
// the ones that differ from the root lockfile without installing anything (#303).
// Copied into each app repository as .standards/lockfiles.mjs (with .standards/lib/lockfiles.mjs).
// Usage: node .standards/lockfiles.mjs [--root <repository>] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkspaceLockfile, compareWorkspaceLockfile, workspaceLockfiles } from './lib/lockfiles.mjs';

export const formatDifference = (d) => `${d.name} ${d.workspace.join('·') || 'none'} (root ${d.root.join('·') || 'none'})`;

/** Returns [{ workspace, file, differences, written }] for every workspace that has its own lockfile. */
export function runLockfiles(root, { write = false } = {}) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  if (!fs.existsSync(path.join(root, 'package-lock.json'))) throw new Error('Root package-lock.json is missing');
  const rootLock = read('package-lock.json');
  const workspaces = workspaceLockfiles(read('package.json'), (rel) => fs.existsSync(path.join(root, rel)));
  return workspaces.map((workspace) => {
    const file = `${workspace}/package-lock.json`;
    const current = read(file);
    const differences = compareWorkspaceLockfile(rootLock, workspace, current);
    let written = false;
    if (write && differences.length) {
      const next = buildWorkspaceLockfile(rootLock, workspace, current);
      const left = compareWorkspaceLockfile(rootLock, workspace, next);
      if (left.length) throw new Error(`Rebuilt ${file}, but ${left.length} still differ: ${left.map(formatDifference).join(', ')}`);
      fs.writeFileSync(path.join(root, file), `${JSON.stringify(next, null, 2)}\n`);
      written = true;
    }
    return { workspace, file, differences, written };
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const flag = process.argv.indexOf('--root');
  const root = flag > 0 ? path.resolve(process.argv[flag + 1]) : path.basename(here) === '.standards' ? path.dirname(here) : process.cwd();
  const write = process.argv.includes('--write');
  try {
    const results = runLockfiles(root, { write });
    let stale = 0;
    for (const r of results) {
      if (!r.differences.length) console.log(`${r.file}: matches the root lockfile`);
      else if (r.written) console.log(`${r.file}: rewritten (${r.differences.length} aligned: ${r.differences.map(formatDifference).join(', ')})`);
      else {
        stale += 1;
        console.error(`${r.file}: ${r.differences.length} package(s) differ from the root lockfile`);
        for (const d of r.differences) console.error(`  ${formatDifference(d)}`);
      }
    }
    if (!results.length) console.log('No sub lockfiles');
    if (stale) {
      console.error('To align: node .standards/lockfiles.mjs --write (rewrites the files from the root lockfile versions without installing)');
      process.exit(1);
    }
  } catch (error) {
    console.error(`lockfiles: ${error.message}`);
    process.exit(2);
  }
}
