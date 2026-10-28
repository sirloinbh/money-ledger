// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 scripts/에서
// Checks that frontend/ and backend/ lockfiles pin the same versions as the root lockfile, and rewrites
// the ones that differ from the root lockfile without installing anything (#303).
// Copied into each app repository as .standards/lockfiles.mjs (with .standards/lib/lockfiles.mjs).
// Usage: node .standards/lockfiles.mjs [--root <repository>] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkspaceLockfile, compareWorkspaceLockfile, workspaceLockfiles } from './lib/lockfiles.mjs';

export const formatDifference = (d) => `${d.name} ${d.workspace.join('·') || '없음'} (루트 ${d.root.join('·') || '없음'})`;

/** Returns [{ workspace, file, differences, written }] for every workspace that has its own lockfile. */
export function runLockfiles(root, { write = false } = {}) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  if (!fs.existsSync(path.join(root, 'package-lock.json'))) throw new Error('루트 package-lock.json이 없습니다');
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
      if (left.length) throw new Error(`${file}를 다시 만들었지만 ${left.length}개가 여전히 다릅니다: ${left.map(formatDifference).join(', ')}`);
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
      if (!r.differences.length) console.log(`${r.file}: 루트 lockfile과 같습니다`);
      else if (r.written) console.log(`${r.file}: 다시 썼습니다 (${r.differences.length}개 맞춤: ${r.differences.map(formatDifference).join(', ')})`);
      else {
        stale += 1;
        console.error(`${r.file}: 루트 lockfile과 다른 패키지 ${r.differences.length}개`);
        for (const d of r.differences) console.error(`  ${formatDifference(d)}`);
      }
    }
    if (!results.length) console.log('하위 lockfile이 없습니다');
    if (stale) {
      console.error('맞추려면: node .standards/lockfiles.mjs --write (설치하지 않고 루트 lockfile의 버전으로 파일만 다시 씁니다)');
      process.exit(1);
    }
  } catch (error) {
    console.error(`lockfiles: ${error.message}`);
    process.exit(2);
  }
}
