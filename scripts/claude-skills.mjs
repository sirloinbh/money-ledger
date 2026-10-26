// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/scripts/에서
// Mirrors the project skills (source of truth: skills/) into .claude/skills/
// so Claude Code loads the same procedures Codex uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in skills requires inspection: ${full}`);
      if (entry.isDirectory()) return listFiles(full, base);
      return [path.relative(base, full).split(path.sep).join('/')];
    })
    .sort();
}

// Git may check files out with CRLF on Windows; compare text by content.
const normalize = (buffer) => buffer.toString('utf8').replace(/\r\n/g, '\n');

export function diffSkills(source, target) {
  const sourceFiles = listFiles(source);
  const targetFiles = new Set(listFiles(target));
  const problems = [];
  for (const file of sourceFiles) {
    if (!targetFiles.has(file)) problems.push(`missing: ${file}`);
    else if (
      normalize(fs.readFileSync(path.join(source, file))) !==
      normalize(fs.readFileSync(path.join(target, file)))
    )
      problems.push(`changed: ${file}`);
    targetFiles.delete(file);
  }
  for (const file of targetFiles) problems.push(`extra: ${file}`);
  return problems;
}

export function syncSkills(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  for (const file of listFiles(source)) {
    const destination = path.join(target, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, file), destination);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = path.join(root, 'skills');
  const target = path.join(root, '.claude/skills');
  if (process.argv[2] === 'sync') {
    syncSkills(source, target);
    console.log('Copied skills/ to .claude/skills/.');
  } else {
    const problems = diffSkills(source, target);
    if (problems.length) {
      console.error(
        `.claude/skills is out of sync with skills/. Run npm run skills:sync.\n${problems.join('\n')}`,
      );
      process.exit(1);
    }
    console.log('.claude/skills matches skills/.');
  }
}
