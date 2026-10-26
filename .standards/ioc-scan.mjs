// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 scripts/에서
// Scans a repository for npm supply-chain attack indicators (Shai-Hulud family):
// blocked packages in lockfiles, install scripts that call exfiltration hosts or run
// dropped files, and suspicious GitHub workflows. Read-only; it never runs package code.
// Copied into project repositories as .standards/ioc-scan.mjs with .standards/blocked-packages.json.
// Usage: node .standards/ioc-scan.mjs [--root <repository>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.local', 'dist', '.terraform']);

export function loadRules(here = path.dirname(fileURLToPath(import.meta.url))) {
  for (const candidate of [path.join(here, 'blocked-packages.json'), path.join(here, '../security/blocked-packages.json')]) {
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  }
  throw new Error('blocked-packages.json을 찾지 못했습니다');
}

// Repository files named `name`, skipping installed dependencies and build output.
function findFiles(root, name, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findFiles(root, name, path.join(dir, entry.name), out);
    } else if (entry.name === name) out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
  }
  return out;
}

const packageNameOf = (lockKey) => lockKey.slice(lockKey.lastIndexOf('node_modules/') + 'node_modules/'.length);

function scriptFindings(where, scripts, rules) {
  const findings = [];
  for (const name of INSTALL_SCRIPTS) {
    const command = scripts?.[name];
    if (!command) continue;
    const host = rules.exfiltrationHosts.find((h) => command.includes(h));
    if (host) findings.push(`${where}: ${name} 스크립트가 외부 유출 의심 주소(${host})를 호출합니다: ${command}`);
    const dropped = rules.suspiciousInstallFiles.find((f) => new RegExp(`\\b${f.replace('.', '\\.')}\\b`).test(command));
    if (dropped) findings.push(`${where}: ${name} 스크립트가 의심 파일(${dropped})을 실행합니다: ${command}`);
  }
  return findings;
}

/** Returns { errors, warnings } as human-readable strings. */
export function scan(root, rules = loadRules()) {
  const errors = [];
  const warnings = [];
  const blocked = new Map(rules.packages.map((p) => [p.name, p.reason]));

  for (const lockfile of findFiles(root, 'package-lock.json')) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, lockfile), 'utf8'));
    const withScripts = [];
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (!key.includes('node_modules/')) continue;
      const name = packageNameOf(key);
      const scope = rules.scopes.find((s) => name.startsWith(`${s.scope}/`));
      if (blocked.has(name)) errors.push(`${lockfile}: 침해 보고된 패키지 ${name}@${entry.version} — ${blocked.get(name)}`);
      else if (scope) errors.push(`${lockfile}: 침해 보고된 스코프의 패키지 ${name}@${entry.version} — ${scope.reason}`);
      if (entry.hasInstallScript) withScripts.push(`${name}@${entry.version}`);
    }
    if (withScripts.length) warnings.push(`${lockfile}: 설치 스크립트가 있는 의존성 ${withScripts.length}개(--ignore-scripts로 설치하면 실행되지 않음): ${[...new Set(withScripts)].join(', ')}`);
  }

  for (const file of findFiles(root, 'package.json')) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    errors.push(...scriptFindings(file, pkg.scripts, rules));
  }

  // Installed packages: only their install scripts are read, never executed.
  const modules = path.join(root, 'node_modules');
  if (fs.existsSync(modules)) {
    for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirs = entry.name.startsWith('@') ? fs.readdirSync(path.join(modules, entry.name)).map((n) => `${entry.name}/${n}`) : [entry.name];
      for (const dir of dirs) {
        const manifest = path.join(modules, dir, 'package.json');
        if (!fs.existsSync(manifest)) continue;
        try {
          errors.push(...scriptFindings(`node_modules/${dir}`, JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts, rules));
        } catch {
          warnings.push(`node_modules/${dir}/package.json을 읽지 못했습니다`);
        }
      }
    }
  }

  const workflows = path.join(root, '.github/workflows');
  if (fs.existsSync(workflows)) {
    for (const name of fs.readdirSync(workflows)) {
      const file = `.github/workflows/${name}`;
      if (rules.suspiciousWorkflowNames.some((s) => name.toLowerCase().includes(s))) errors.push(`${file}: 침해 사례와 같은 이름의 워크플로입니다`);
      const text = fs.readFileSync(path.join(workflows, name), 'utf8');
      const host = rules.exfiltrationHosts.find((h) => text.includes(h));
      if (host) errors.push(`${file}: 외부 유출 의심 주소(${host})가 들어 있습니다`);
    }
  }
  return { errors, warnings };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const flag = process.argv.indexOf('--root');
  const root = flag > 0 ? path.resolve(process.argv[flag + 1]) : path.basename(here) === '.standards' ? path.dirname(here) : process.cwd();
  try {
    const { errors, warnings } = scan(root);
    for (const w of warnings) console.log(`경고: ${w}`);
    for (const e of errors) console.error(`✗ ${e}`);
    if (errors.length) {
      console.error(`\nioc-scan: 의심 항목 ${errors.length}개. 설치·실행을 멈추고 사용자에게 알린 뒤 확인하세요.`);
      process.exit(1);
    }
    console.log('ioc-scan: 의심 항목 없음');
  } catch (error) {
    console.error(`ioc-scan: ${error.message}`);
    process.exit(2);
  }
}
