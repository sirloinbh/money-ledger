// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 scripts/에서
// Scans a repository for committed secrets: tokens and keys with a recognizable shape,
// private key blocks, and committed .env files. Read-only, and it never prints the value it found.
// Only high-confidence patterns are checked so CI can fail on any finding; GitHub secret scanning
// covers the wider set of providers (docs/repo-settings.md).
// Copied into project repositories as .standards/secret-scan.mjs.
// Usage: node .standards/secret-scan.mjs [--root <repository>] [--history]
//   --history  also scans every line added in the git history of all branches
// A line that holds a deliberate fake value can be allowed with the marker `secret-scan:allow`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = [
  { id: 'github-token', name: 'GitHub 토큰', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-pat', name: 'GitHub fine-grained 토큰', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}/ },
  { id: 'anthropic-key', name: 'Anthropic(Claude) API 키', pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}/ },
  { id: 'openai-key', name: 'OpenAI API 키', pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,}/ },
  { id: 'aws-access-key', name: 'AWS 액세스 키 ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'aws-secret-key', name: 'AWS 비밀 액세스 키', pattern: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+]{40}\b/i },
  { id: 'npm-token', name: 'npm 토큰', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'slack-token', name: 'Slack 토큰', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', name: 'Google API 키', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-live-key', name: 'Stripe 운영 키', pattern: /\b[rs]k_live_[0-9A-Za-z]{24,}/ },
  { id: 'private-key', name: '개인키', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
];

export const ALLOW_MARKER = 'secret-scan:allow';
const SKIP_DIRS = new Set(['node_modules', '.git', '.local', 'dist', '.terraform', 'coverage', 'playwright-report', 'test-results']);
const MAX_BYTES = 1024 * 1024;

// .env files hold real values and must never be committed. Examples and templates are fine.
export function isEnvFile(file) {
  const name = file.split('/').pop();
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template|tmpl)$/.test(name);
}

/** Findings for one text: [{ line, rule }]. Never includes the matched value. */
export function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((content, index) => {
    if (content.includes(ALLOW_MARKER)) return;
    for (const rule of RULES) if (rule.pattern.test(content)) findings.push({ line: index + 1, rule });
  });
  return findings;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

function walk(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, path.join(dir, entry.name), out);
    } else if (entry.isFile()) out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
  }
  return out;
}

// Tracked files when the folder is a git repository (what would be pushed), otherwise every file.
export function listFiles(root) {
  const tracked = fs.existsSync(path.join(root, '.git')) ? git(root, ['ls-files', '-z']) : null;
  const files = tracked === null ? walk(root) : tracked.split('\0').filter(Boolean);
  return files.filter((file) => !file.split('/').some((part) => SKIP_DIRS.has(part)));
}

function readText(file) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_BYTES) return null;
  const buffer = fs.readFileSync(file);
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

/** Returns human-readable error strings for the working tree. */
export function scan(root) {
  const errors = [];
  for (const file of listFiles(root)) {
    if (isEnvFile(file)) errors.push(`${file}: .env 파일이 커밋 대상에 있습니다. 값은 서버·PC에만 두고 .env.example만 커밋하세요`);
    const text = readText(path.join(root, file));
    if (text === null) continue;
    for (const { line, rule } of scanText(text)) errors.push(`${file}:${line}: ${rule.name}(${rule.id}) 모양의 값이 있습니다`);
  }
  return errors;
}

/** Scans the lines added by every commit on every branch. Returns error strings, or null outside git. */
export function scanHistory(root) {
  const log = git(root, ['log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=commit %h']);
  if (log === null) return null;
  const seen = new Set();
  const errors = [];
  let commit = '';
  let file = '';
  for (const raw of log.split('\n')) {
    if (raw.startsWith('commit ')) commit = raw.slice(7).trim();
    else if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
      if (file !== '/dev/null' && isEnvFile(file) && !seen.has(`env:${file}`)) {
        seen.add(`env:${file}`);
        errors.push(`${commit} ${file}: .env 파일이 커밋된 적이 있습니다`);
      }
    } else if (raw.startsWith('+') && !raw.includes(ALLOW_MARKER)) {
      for (const rule of RULES) {
        const key = `${commit}:${file}:${rule.id}`;
        if (!seen.has(key) && rule.pattern.test(raw)) {
          seen.add(key);
          errors.push(`${commit} ${file}: ${rule.name}(${rule.id}) 모양의 값이 추가된 적이 있습니다`);
        }
      }
    }
  }
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const flag = process.argv.indexOf('--root');
  const root = flag > 0 ? path.resolve(process.argv[flag + 1]) : path.basename(here) === '.standards' ? path.dirname(here) : process.cwd();
  try {
    const errors = scan(root);
    if (process.argv.includes('--history')) {
      const history = scanHistory(root);
      if (history === null) throw new Error('git 이력을 읽지 못했습니다');
      errors.push(...history);
    }
    for (const e of errors) console.error(`✗ ${e}`);
    if (errors.length) {
      console.error(`\nsecret-scan: 의심 항목 ${errors.length}개. 진짜 값이면 먼저 그 키를 폐기·교체하고, 커밋에서 지운 뒤 사용자에게 알리세요.`);
      console.error(`테스트용 가짜 값이면 그 줄에 \`${ALLOW_MARKER}\` 주석을 붙이세요.`);
      process.exit(1);
    }
    console.log('secret-scan: 의심 항목 없음');
  } catch (error) {
    console.error(`secret-scan: ${error.message}`);
    process.exit(2);
  }
}
