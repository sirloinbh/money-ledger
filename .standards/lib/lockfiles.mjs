// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 scripts/lib/에서
// Compares and rebuilds the workspace lockfiles (frontend/, backend/) of an app from its root lockfile.
// CI installs from the root lockfile; the production Docker builds install from the workspace lockfiles,
// so the two must resolve every package to the same version (#303).
// Copied into app repositories as .standards/lib/lockfiles.mjs: Node built-ins only.

const NM = 'node_modules/';
const FLAGS = ['dev', 'optional', 'devOptional', 'peer'];

const child = (loc, name) => `${loc ? `${loc}/` : ''}${NM}${name}`;

// '' is the lockfile root; a workspace ('frontend') sits under the root like a top-level package.
function parentOf(loc) {
  const i = loc.lastIndexOf(NM);
  if (i < 0) return loc === '' ? null : '';
  return loc.slice(0, i).replace(/\/$/, '');
}

// Node's lookup: the nearest node_modules/<name> on the way up from `from`.
function resolve(packages, from, name) {
  for (let loc = from; loc !== null; loc = parentOf(loc)) {
    const key = child(loc, name);
    if (packages[key]) return key;
  }
  return null;
}

// Only the project itself installs its devDependencies; a dependency's own devDependencies are never installed.
// Bundled dependencies ship inside the package's tarball, and npm does not always list them, so they are skipped.
// Optional peers are followed only for flags: npm installs them only when another edge asks for them, while in
// the root lockfile they can resolve to a package another workspace installed (vite's optional peer tsx, from backend).
function edges(entry, isProject, optionalPeers) {
  const out = [];
  const bundled = new Set(entry.bundleDependencies ?? entry.bundledDependencies ?? []);
  const add = (deps, type) => Object.keys(deps ?? {}).forEach((name) => bundled.has(name) || out.push({ name, type }));
  const peers = Object.keys(entry.peerDependencies ?? {});
  const isOptionalPeer = (name) => Boolean(entry.peerDependenciesMeta?.[name]?.optional);
  // A name listed both as a dependency and an optional dependency is optional (npm moves it), so optional goes first.
  add(entry.optionalDependencies, 'optional');
  add(entry.dependencies, 'prod');
  if (isProject) add(entry.devDependencies, 'dev');
  add(Object.fromEntries(peers.filter((name) => !isOptionalPeer(name)).map((name) => [name, ''])), 'prod');
  if (optionalPeers) add(Object.fromEntries(peers.filter(isOptionalPeer).map((name) => [name, ''])), 'optional');
  const seen = new Set();
  return out.filter((e) => !seen.has(e.name) && seen.add(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Every package reachable from `start` (a lockfile key) as { key: [{ name, type, to }] }. */
export function graph(lock, start, { optionalPeers = false } = {}) {
  const packages = lock.packages ?? {};
  if (!packages[start]) throw new Error(`lockfile에 "${start || '(루트)'}" 항목이 없습니다`);
  const out = new Map();
  const queue = [start];
  while (queue.length) {
    const key = queue.shift();
    if (out.has(key)) continue;
    const list = [];
    out.set(key, list);
    for (const { name, type } of edges(packages[key], key === start, optionalPeers)) {
      let to = resolve(packages, key, name);
      if (to && packages[to].link) to = packages[to].resolved ?? to;
      if (!to || !packages[to]) {
        if (type === 'optional') continue;
        throw new Error(`${key || '(루트)'}의 의존성 ${name}을(를) lockfile에서 찾을 수 없습니다`);
      }
      list.push({ name, type, to });
      queue.push(to);
    }
  }
  return out;
}

const nameOf = (lock, key) => {
  const i = key.lastIndexOf(NM);
  return i < 0 ? lock.packages[key].name : key.slice(i + NM.length);
};

function versionsByName(lock, start) {
  const out = new Map();
  for (const key of graph(lock, start).keys()) {
    if (key === start) continue;
    const name = nameOf(lock, key);
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(lock.packages[key].version);
  }
  return out;
}

/**
 * Packages whose installed versions differ between the workspace lockfile and the root lockfile's
 * view of that workspace. Where a package sits (hoisted or nested) does not matter, only the versions.
 * Returns [{ name, workspace: [versions], root: [versions] }], sorted by name.
 */
export function compareWorkspaceLockfile(rootLock, workspace, subLock) {
  const sub = versionsByName(subLock, '');
  const root = versionsByName(rootLock, workspace);
  const sorted = (set) => [...(set ?? [])].sort();
  return [...new Set([...sub.keys(), ...root.keys()])]
    .filter((name) => sorted(sub.get(name)).join() !== sorted(root.get(name)).join())
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => ({ name, workspace: sorted(sub.get(name)), root: sorted(root.get(name)) }));
}

// npm's flags: dev = needed only through the project's devDependencies, optional = only through optional
// edges, devOptional = only through edges that are dev or optional (but neither alone).
export function depFlags(nodes, start) {
  const reach = (skip) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const e of nodes.get(queue.shift()) ?? []) {
        if (skip.includes(e.type) || seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    return seen;
  };
  const notDev = reach(['dev']);
  const notOptional = reach(['optional']);
  const prod = reach(['dev', 'optional']);
  const flags = new Map();
  for (const key of nodes.keys()) {
    if (key === start) continue;
    const dev = !notDev.has(key);
    const optional = !notOptional.has(key);
    flags.set(key, { dev, optional, devOptional: !prod.has(key) && !dev && !optional });
  }
  return flags;
}

/** The dev/optional/devOptional flags npm would write for every package of a lockfile. */
export function lockfileFlags(lock) {
  return depFlags(graph(lock, '', { optionalPeers: true }), '');
}

function withFlags(entry, flags) {
  const out = {};
  const keys = Object.keys(entry);
  const anchor = keys.includes('integrity') ? 'integrity' : keys.includes('resolved') ? 'resolved' : 'version';
  for (const k of keys) {
    if (FLAGS.includes(k)) {
      if (flags[k]) out[k] = true;
      continue;
    }
    out[k] = entry[k];
    if (k === anchor) for (const f of FLAGS) if (flags[f] && !(f in entry)) out[f] = true;
  }
  return out;
}

/**
 * Writes the workspace lockfile that `npm install` inside the workspace would produce from the
 * versions the root lockfile already pins. Nothing is downloaded: entries (resolved, integrity) are
 * copied from the root lockfile, and only the placement and the dev/optional flags are recomputed.
 * `previous` is the workspace lockfile being replaced (for bundled packages the root lockfile leaves out).
 */
export function buildWorkspaceLockfile(rootLock, workspace, previous = null) {
  const src = rootLock.packages;
  const nodes = graph(rootLock, workspace);
  for (const [key, list] of nodes) {
    for (const e of list) {
      if (!e.to.includes(NM)) throw new Error(`${key || '(루트)'}가 다른 workspace(${e.to})를 씁니다. 하위 lockfile로 만들 수 없습니다`);
    }
  }
  // Place each package as high as possible without shadowing a different version on the way up.
  const placed = new Map([['', workspace]]);
  const queue = [''];
  while (queue.length) {
    const loc = queue.shift();
    for (const e of nodes.get(placed.get(loc))) {
      let found = null;
      for (let l = loc; l !== null && !found; l = parentOf(l)) if (placed.has(child(l, e.name))) found = child(l, e.name);
      if (found && placed.get(found) === e.to) continue;
      const key = found ? child(loc, e.name) : child('', e.name);
      placed.set(key, e.to);
      queue.push(key);
    }
  }
  // Flags follow the new tree: the workspace is now the project, so its devDependencies are dev here.
  const { name, version } = src[workspace];
  const bare = (entry) => Object.fromEntries(Object.entries(entry).filter(([k]) => !FLAGS.includes(k)));
  const packages = { '': bare(src[workspace]) };
  for (const key of [...placed.keys()].filter((k) => k).sort((a, b) => a.localeCompare(b, 'en'))) packages[key] = bare(src[placed.get(key)]);
  const flags = lockfileFlags({ packages });
  const entries = [['', packages['']]];
  for (const [key, from] of placed) {
    if (!key) continue;
    entries.push([key, withFlags(src[from], flags.get(key))]);
    // Bundled packages move with their package and share its flags. The root lockfile does not always list
    // them (npm leaves them out for some optional platform packages), so the previous workspace lockfile fills in.
    const bundled = Object.entries(src).filter(([k, v]) => v.inBundle && k.startsWith(`${from}/${NM}`)).map(([k, v]) => [key + k.slice(from.length), v]);
    if (!bundled.length && src[from].bundleDependencies && previous?.packages?.[key]?.version === src[from].version) {
      bundled.push(...Object.entries(previous.packages).filter(([k, v]) => v.inBundle && k.startsWith(`${key}/${NM}`)));
    }
    for (const [k, v] of bundled) entries.push([k, withFlags(v, flags.get(key))]);
  }
  const sorted = Object.fromEntries(entries.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'en'))));
  return { name, ...(version === undefined ? {} : { version }), lockfileVersion: 3, requires: true, packages: sorted };
}

/** The workspaces of a root package.json that have their own lockfile (frontend/, backend/). */
export function workspaceLockfiles(rootPackage, exists) {
  const list = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : (rootPackage.workspaces?.packages ?? []);
  return list.filter((ws) => !/[*?]/.test(ws) && exists(`${ws}/package-lock.json`));
}
