// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 scripts/에서
// Checks a project repository against the central standard recorded in .standards/manifest.json.
// Copied into each repository as .standards/check.mjs (with .standards/lib/), so it uses only
// Node built-ins and its sibling lib/ files.
// Usage: node .standards/check.mjs [--root <repository>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareWorkspaceLockfile, workspaceLockfiles } from './lib/lockfiles.mjs';
import { checkManifest, MANIFEST_PATH } from './lib/manifest.mjs';

const CENTRAL = 'sirloinbh/project-standards';
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

const REASONS = {
  missing: '파일이 없습니다',
  changed: '내용이 중앙 원본과 다릅니다',
  'central section changed': '`# --- project ---` 위의 중앙 구간이 바뀌었습니다',
  'project marker removed': '`# --- project ---` 줄이 없어졌습니다',
  'not valid JSON': 'JSON 형식이 깨졌습니다',
};
const reasonText = (reason) => REASONS[reason] ?? reason.replace(/^field\(s\) changed: /, '관리 필드가 다릅니다: ');

// Where each registry value appears in an app repository. A file that does not exist is skipped;
// a file that exists but no longer contains the pattern is reported as a warning.
export function portRules({ ports, db }) {
  return [
    { file: 'compose.yaml', label: '웹 포트', pattern: /(\d{4,5})\}?:80\b/g, expected: ports.web },
    { file: 'compose.yaml', label: '호스트 DB 포트', pattern: /(\d{4,5})\}?:5432\b/g, expected: ports.db },
    { file: 'compose.yaml', label: 'API 포트', pattern: /\bPORT:\s*['"]?(\d{4,5})/g, expected: ports.api },
    { file: 'frontend/vite.config.ts', label: 'Vite 포트', pattern: /\bport:\s*(\d{4,5})/g, expected: ports.vite },
    { file: 'frontend/vite.config.ts', label: 'API 프록시 포트', pattern: /127\.0\.0\.1:(\d{4,5})/g, expected: ports.api },
    { file: 'frontend/nginx.conf', label: 'API 프록시 포트', pattern: /proxy_pass\s+http:\/\/api:(\d{4,5})/g, expected: ports.api },
    { file: 'backend/Dockerfile', label: 'API 포트(EXPOSE)', pattern: /^EXPOSE\s+(\d{4,5})/gm, expected: ports.api },
    { file: 'backend/src/server.ts', label: 'API 기본 포트', pattern: /PORT\s*\?\?\s*(\d{4,5})/g, expected: ports.api },
    { file: '.env.example', label: 'API 포트', pattern: /^PORT=(\d{4,5})/gm, expected: ports.api },
    { file: '.env.example', label: 'DB 포트', pattern: /^DATABASE_URL=.*@localhost:(\d{4,5})\//gm, expected: ports.db },
    { file: '.env.example', label: 'DB 이름', pattern: /^POSTGRES_DB=(\S+)/gm, expected: db.name },
    { file: '.env.example', label: 'DATABASE_URL의 DB 이름', pattern: /^DATABASE_URL=.*\/([a-z0-9_]+)\s*$/gm, expected: db.name },
    { file: 'playwright.config.ts', label: 'e2e API 포트', contains: ports.e2eApi },
    { file: 'playwright.config.ts', label: 'e2e 웹 포트', contains: ports.e2eWeb },
  ];
}

function checkRegistry(registry, read, problems, warnings) {
  for (const rule of portRules(registry)) {
    const text = read(rule.file);
    if (text === null) continue;
    if (rule.contains !== undefined) {
      if (!new RegExp(`\\b${rule.contains}\\b`).test(text)) problems.push({ group: '레지스트리 값', path: rule.file, message: `${rule.label} ${rule.contains}이(가) 없습니다` });
      continue;
    }
    const found = [...text.matchAll(rule.pattern)].map((m) => m[1]);
    if (!found.length) {
      warnings.push(`${rule.file}: ${rule.label}을(를) 찾지 못했습니다. 형식이 바뀌었다면 중앙 검사 규칙을 갱신해야 합니다.`);
      continue;
    }
    for (const value of new Set(found)) {
      if (value !== String(rule.expected)) problems.push({ group: '레지스트리 값', path: rule.file, message: `${rule.label}이(가) ${value}입니다. 레지스트리 값은 ${rule.expected}입니다` });
    }
  }
  const vite = read('frontend/vite.config.ts');
  if (vite !== null && !/strictPort:\s*true/.test(vite)) warnings.push('frontend/vite.config.ts: strictPort: true가 없어 포트가 겹치면 다른 포트로 넘어갑니다.');
}

// The managed Dockerfiles read the package token from the BuildKit secret "npm_token", so every
// compose build must pass it and the secret must come from NODE_AUTH_TOKEN (design.md 5.1).
export function checkComposeSecrets(text) {
  const problems = [];
  const builds = (text.match(/^\s+build:/gm) ?? []).length;
  const passed = (text.match(/secrets:\s*\[\s*npm_token\s*\]/g) ?? []).length + (text.match(/secrets:\s*\n\s+-\s*npm_token\b/g) ?? []).length;
  if (!/^secrets:\s*\n\s+npm_token:\s*\n\s+environment:\s*['"]?NODE_AUTH_TOKEN['"]?\s*$/m.test(text)) problems.push('최상위 secrets.npm_token.environment: NODE_AUTH_TOKEN이 없습니다');
  if (passed < builds) problems.push(`build ${builds}개 중 ${passed}개만 secrets: [npm_token]을 넘깁니다`);
  return problems;
}

// API rules from docs/directory-rules.md "API". Warnings only: the apps grew different layouts
// (routes/ modules or Routers in src/), so these look for the rules, not for one file layout.
// sources: [{ file: 'backend/src/…', text }] without tests. Returns warning strings.
const API_SEGMENT = /^(:\w+|\*\w*|[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)?)$/;
export function checkApi(sources) {
  const warnings = [];
  const app = sources.find((s) => s.file === 'backend/src/app.ts');
  if (!app) return warnings;
  const at = (source, index) => `${source.file}:${source.text.slice(0, index).split('\n').length}`;
  if (!sources.some((s) => /\bapp\.get\(\s*['"`]\/api\/health['"`]/.test(s.text))) warnings.push('backend/src: GET /api/health가 없습니다. 모든 앱은 DB 연결을 확인하는 상태 확인 API를 둡니다.');
  if (!/\bapp\.use\(\s*(errorHandler\b|\(\s*err\b)/.test(app.text)) warnings.push('backend/src/app.ts: 오류 처리 미들웨어(app.use(errorHandler))가 없어 오류가 { error } 형식으로 나가지 않습니다.');
  if (!/\bapp\.use\(\s*['"`]\/api['"`]\s*,/.test(app.text)) warnings.push("backend/src/app.ts: 없는 /api 경로에 404 { error }로 답하는 app.use('/api', notFound)가 없습니다.");
  for (const source of sources) {
    for (const m of source.text.matchAll(/\bapp\.(get|post|put|patch|delete|use)\(\s*['"]([^'"]+)['"]/g)) {
      const route = m[2];
      if (!/^\/api(\/|$)/.test(route)) {
        warnings.push(`${at(source, m.index)}: API 경로 ${route}는 /api로 시작해야 합니다.`);
        continue;
      }
      const bad = route.split('/').filter(Boolean).find((segment) => !API_SEGMENT.test(segment));
      if (bad) warnings.push(`${at(source, m.index)}: API 경로 ${route}의 "${bad}"는 소문자 영어와 하이픈으로 씁니다.`);
    }
    for (const m of source.text.matchAll(/\.status\(\s*([45]\d\d)\s*\)\s*\.json\(\s*\{\s*(\w+)\s*:/g)) {
      if (m[2] !== 'error') warnings.push(`${at(source, m.index)}: ${m[1]} 응답이 { ${m[2]} } 형식입니다. 오류 응답은 { error: '<한국어 메시지>' }로 씁니다.`);
    }
    for (const m of source.text.matchAll(/\breq\.(body|query)\.\w+/g)) {
      warnings.push(`${at(source, m.index)}: ${m[0]}를 검증 없이 읽습니다. req.${m[1]}는 Zod 스키마의 parse()로 먼저 검증합니다.`);
    }
  }
  return warnings;
}

// End index of the parenthesized group whose "(" is just before `start`.
function closeParen(text, start) {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    i++;
  }
  return i;
}

// A zod array with no length limit lets one large request raise an issue per element until memory runs out
// (GHSA-mrhx-c7xc-m3w5, #326). Follows the method chain after `.array(...)` across lines for .max()/.length().
export function checkZodArrays(sources) {
  const warnings = [];
  for (const source of sources) {
    if (!/from ['"]zod(\/v[34])?['"]/.test(source.text)) continue;
    for (const m of source.text.matchAll(/\.array\(/g)) {
      let i = closeParen(source.text, m.index + m[0].length);
      const chain = [];
      for (let next; (next = source.text.slice(i).match(/^\s*\.(\w+)\(/)); ) {
        chain.push(next[1]);
        i = closeParen(source.text, i + next[0].length);
      }
      const line = source.text.slice(0, m.index).split('\n').length;
      const limit = chain.findIndex((name) => name === 'max' || name === 'length');
      if (limit < 0) {
        warnings.push(`${source.file}:${line}: 배열 스키마에 길이 제한이 없습니다. .max(<개수>)를 붙입니다(zod 보안 권고 GHSA-mrhx-c7xc-m3w5).`);
      } else if (chain.slice(0, limit).some((name) => ['refine', 'superRefine', 'check'].includes(name))) {
        // zod 4.6.7 rejects before reading elements only when the length checks come first (#386).
        warnings.push(`${source.file}:${line}: 배열의 .${chain[limit]}()가 .refine 뒤에 있어 원소를 모두 읽은 뒤에 거절합니다. 길이 제한을 앞으로 옮깁니다(zod 보안 권고 GHSA-mrhx-c7xc-m3w5).`);
      }
    }
  }
  return warnings;
}

// Frontend file names are lowercase words joined by hyphens; dots only separate kinds (docs/conventions/code.md, #312).
const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
export function checkFileNames(files) {
  const bad = files.filter((rel) => /\.(ts|tsx)$/.test(rel) && !FILE_NAME.test(rel.split('/').pop()));
  if (!bad.length) return [];
  const shown = bad.slice(0, 5).join(', ');
  return [`frontend/src: 파일 이름은 소문자와 하이픈으로 씁니다(docs/conventions/code.md). ${bad.length}개: ${shown}${bad.length > 5 ? ' 외' : ''}`];
}

function frontendFiles(root) {
  const dir = path.join(root, 'frontend/src');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map((rel) => String(rel).split(path.sep).join('/'))
    .filter((rel) => !rel.split('/').includes('node_modules') && fs.statSync(path.join(dir, rel)).isFile())
    .sort()
    .map((rel) => `frontend/src/${rel}`);
}

function apiSources(root) {
  const dir = path.join(root, 'backend/src');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map((rel) => String(rel).split(path.sep).join('/'))
    .filter((rel) => rel.endsWith('.ts') && !/\.(test|d)\.ts$/.test(rel) && !rel.split('/').includes('node_modules'))
    .sort()
    .map((rel) => ({ file: `backend/src/${rel}`, text: fs.readFileSync(path.join(dir, rel), 'utf8') }));
}

function checkPackages(packages, read, problems) {
  for (const [name, version] of Object.entries(packages ?? {})) {
    if (version === null) continue;
    const text = read(`node_modules/${name}/package.json`);
    if (text === null) {
      problems.push({ group: '공유 패키지', path: name, message: `설치되어 있지 않습니다(기대 버전 ${version}). npm ci를 먼저 실행하세요` });
      continue;
    }
    const pkg = JSON.parse(text);
    if (pkg.version !== version) problems.push({ group: '공유 패키지', path: name, message: `설치 버전 ${pkg.version}, 기대 버전 ${version}` });
    const scripts = INSTALL_SCRIPTS.filter((s) => pkg.scripts?.[s]);
    if (scripts.length) problems.push({ group: '공유 패키지', path: name, message: `설치 스크립트가 있습니다: ${scripts.join(', ')}` });
    if (Object.keys(pkg.dependencies ?? {}).length) problems.push({ group: '공유 패키지', path: name, message: 'dependencies가 비어 있지 않습니다' });
  }
}

// CI installs from the root lockfile and the Docker builds from frontend/ and backend/ lockfiles (#303).
function checkLockfiles(read, problems) {
  const rootPackage = read('package.json');
  const rootLock = read('package-lock.json');
  if (rootPackage === null || rootLock === null) return;
  const lock = JSON.parse(rootLock);
  for (const workspace of workspaceLockfiles(JSON.parse(rootPackage), (rel) => read(rel) !== null)) {
    const file = `${workspace}/package-lock.json`;
    let differences;
    try {
      differences = compareWorkspaceLockfile(lock, workspace, JSON.parse(read(file)));
    } catch (error) {
      problems.push({ group: '하위 lockfile', path: file, message: error.message });
      continue;
    }
    if (!differences.length) continue;
    const shown = differences.slice(0, 5).map((d) => `${d.name} ${d.workspace.join('·') || '없음'} (루트 ${d.root.join('·') || '없음'})`);
    problems.push({
      group: '하위 lockfile',
      path: file,
      message: `루트 package-lock.json과 버전이 다른 패키지 ${differences.length}개: ${shown.join(', ')}${differences.length > 5 ? ' 외' : ''}. node .standards/lockfiles.mjs --write로 맞춥니다`,
    });
  }
}

/** Returns { problems: [{ group, path, message }], warnings: [string], manifest }. */
export function runCheck(root) {
  const read = (rel) => {
    const file = path.join(root, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  const manifestText = read(MANIFEST_PATH);
  if (manifestText === null) throw new Error(`${MANIFEST_PATH}가 없습니다. 이 리포는 아직 중앙 표준과 동기화되지 않았습니다.`);
  const manifest = JSON.parse(manifestText);
  const problems = [];
  const warnings = [];
  for (const { path: file, reason } of checkManifest(manifest, read)) {
    const source = manifest.files[file].source;
    problems.push({ group: '관리 파일', path: file, message: `${reasonText(reason)}${source ? ` (중앙 원본: ${source})` : ''}` });
  }
  checkPackages(manifest.packages, read, problems);
  if (manifest.registry) checkRegistry(manifest.registry, read, problems, warnings);
  checkLockfiles(read, problems);
  const backend = apiSources(root);
  warnings.push(...checkApi(backend));
  warnings.push(...checkZodArrays(backend));
  warnings.push(...checkFileNames(frontendFiles(root)));
  const compose = read('compose.yaml');
  if (compose !== null && (manifest.files['frontend/Dockerfile'] || manifest.files['backend/Dockerfile'])) {
    for (const message of checkComposeSecrets(compose)) problems.push({ group: '빌드 secret', path: 'compose.yaml', message });
  }
  return { problems, warnings, manifest };
}

export function formatReport({ problems, warnings, manifest }) {
  const lines = [];
  for (const w of warnings) lines.push(`경고: ${w}`);
  if (!problems.length) {
    lines.push(`standards-check: 통과 (중앙 ${CENTRAL}@${String(manifest.centralSha).slice(0, 7)})`);
    return lines.join('\n');
  }
  lines.push(`standards-check: 중앙 표준과 다른 곳 ${problems.length}개`);
  for (const group of [...new Set(problems.map((p) => p.group))]) {
    lines.push('', `[${group}]`);
    for (const p of problems.filter((x) => x.group === group)) lines.push(`  ✗ ${p.path} — ${p.message}`);
  }
  lines.push(
    '',
    '고치는 방법:',
    `  1. 중앙 관리 파일·버전·포트는 이 리포가 아니라 ${CENTRAL}에서 고칩니다.`,
    `       ghp issue create -R ${CENTRAL} --title "<무엇을 바꿀지>"`,
    '       (project-standards에서) git switch -c fix/<이슈번호>-<영문-요약>',
    '       위에 적힌 "중앙 원본" 파일을 고친 뒤 PR을 엽니다. 병합되면 이 리포에 동기화 PR이 열립니다.',
    '  2. 이 프로젝트만 다르게 둬야 한다면 중앙 registry/projects.json의 allowedDifferences에 경로와 사유를 등록하는 PR을 엽니다.',
    '  3. 이 리포에 열린 동기화 PR(chore/standards-sync-*)이 있으면, 그 PR을 먼저 병합하면 맞춰질 수 있습니다.',
  );
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const flag = process.argv.indexOf('--root');
  const root = flag > 0 ? path.resolve(process.argv[flag + 1]) : path.basename(here) === '.standards' ? path.dirname(here) : process.cwd();
  try {
    const result = runCheck(root);
    const report = formatReport(result);
    if (result.problems.length) {
      console.error(report);
      process.exit(1);
    }
    console.log(report);
  } catch (error) {
    console.error(`standards-check: ${error.message}`);
    process.exit(2);
  }
}
