// Managed file. Edit it in sirloinbh/project-standards scripts/
// Reports dependencies in package-lock.json whose license is not on the allow list in docs/dependency-policy.md (#1062).
// Read-only, Node built-ins only. Copied into app repositories as .standards/license-check.mjs.
// Usage: node .standards/license-check.mjs [--root <repository>] [--strict]
//   By default it only warns (GitHub Actions ::warning lines) and exits 0. --strict exits 1 when anything is reported.
// SPDX expressions: `A OR B` passes when any side is allowed, `A AND B` when every side is, `X WITH exception` counts as X.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Python-2.0', 'CC-BY-4.0'];
const OWN_SCOPE = '@sirloinbh/';

/** The license text of one lockfile entry as a string, or '' when it declares none. Reads the legacy object and array forms too. */
export function licenseText(entry) {
  const value = entry.license ?? entry.licenses;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : v?.type)).filter(Boolean).join(' OR ');
  if (value && typeof value === 'object') return String(value.type ?? '').trim();
  return '';
}

/** Whether an SPDX expression is covered by the allow list. */
export function isAllowed(expression, allowed = ALLOWED) {
  const text = expression.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const set = new Set(allowed.map((a) => a.toLowerCase()));
  const term = (t) => set.has(t.replace(/\s+WITH\s+.*$/i, '').trim().toLowerCase());
  // OR binds looser than AND: allowed when some OR-branch has every AND-term allowed.
  return text.split(/\s+OR\s+/i).some((branch) => branch.split(/\s+AND\s+/i).every(term));
}

/** Findings for one parsed package-lock.json: [{ name, version, license }] sorted by name. */
export function findOutside(lock, allowed = ALLOWED) {
  const findings = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === '' || entry.link) continue;
    const name = entry.name ?? key.split('node_modules/').pop();
    if (name.startsWith(OWN_SCOPE)) continue;
    const license = licenseText(entry);
    if (!isAllowed(license, allowed)) findings.push({ name, version: entry.version ?? '', license: license || 'none declared' });
  }
  return findings.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const flag = process.argv.indexOf('--root');
  const root = flag > 0 ? path.resolve(process.argv[flag + 1]) : process.cwd();
  const file = path.join(root, 'package-lock.json');
  try {
    if (!fs.existsSync(file)) {
      console.log('license-check: no package-lock.json, nothing to check');
      process.exit(0);
    }
    const findings = findOutside(JSON.parse(fs.readFileSync(file, 'utf8')));
    const strict = process.argv.includes('--strict');
    for (const f of findings) {
      const message = `${f.name}@${f.version} has license "${f.license}", which is not on the allow list`;
      console.log(process.env.GITHUB_ACTIONS ? `::warning title=license-check::${message}` : `${strict ? '✗' : '!'} ${message}`);
    }
    if (!findings.length) console.log(`license-check: all dependency licenses are on the allow list (${ALLOWED.join(', ')})`);
    else console.log(`\nlicense-check: ${findings.length} package(s) outside the allow list. See "Licenses" in docs/dependency-policy.md.`);
    process.exit(strict && findings.length ? 1 : 0);
  } catch (error) {
    console.error(`license-check: ${error.message}`);
    process.exit(2);
  }
}
