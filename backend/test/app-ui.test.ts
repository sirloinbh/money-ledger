import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, unknown> & { children: unknown[] } };

// Minimal React stand-in: renders function components, supports useState/useEffect on the App.
function mount(fetchImpl: (path: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>) {
  const states: unknown[] = [];
  const effectDeps: unknown[][] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  let element: Node | undefined;
  const react = {
    Fragment: 'fragment',
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => ({
      type,
      props: { ...(props ?? {}), children: children.flat() },
    }),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        states[index],
        (next: unknown) => {
          states[index] =
            typeof next === 'function' ? (next as (v: unknown) => unknown)(states[index]) : next;
        },
      ];
    },
    useEffect(effect: () => void, deps?: unknown[]) {
      const index = cursor++;
      const previous = effectDeps[index];
      if (!deps || !previous || deps.some((d, i) => d !== previous[i])) {
        effectDeps[index] = deps ?? [];
        pending.push(effect);
      }
    },
  };
  const source = ts.transpileModule(
    readFileSync(new URL('../../frontend/src/main.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const load = (file: string) => {
    const exports = {};
    runInNewContext(
      ts.transpileModule(
        readFileSync(new URL('../../frontend/src/' + file, import.meta.url), 'utf8'),
        {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        },
      ).outputText,
      { exports },
    );
    return exports;
  };
  runInNewContext(source, {
    exports: {},
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react-dom/client')
        return { createRoot: () => ({ render: (v: Node) => (element = v) }) };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name.endsWith('.css')) return {};
      if (name === './health') return load('health.ts');
      throw new Error('Unexpected import: ' + name);
    },
    document: { getElementById: () => ({}) },
    fetch: fetchImpl,
    console,
  });
  const resolve = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(resolve);
    if (!node || typeof node !== 'object') return node;
    const { type, props } = node as Node;
    if (typeof type === 'function') return resolve(type(props));
    return { type, props: { ...props, children: props.children.map(resolve) } };
  };
  let tree: unknown;
  const render = () => {
    cursor = 0;
    tree = resolve(element);
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      render();
      const effects = pending;
      pending = [];
      effects.forEach((effect) => effect());
      await new Promise((r) => setImmediate(r));
    }
    render();
  };
  const text = (node: unknown = tree): string =>
    Array.isArray(node)
      ? node.map(text).join('')
      : node && typeof node === 'object'
        ? text((node as Node).props.children)
        : node === null || node === undefined || node === false
          ? ''
          : String(node);
  const find = (match: (n: Node) => boolean, node: unknown = tree): Node[] => {
    if (Array.isArray(node)) return node.flatMap((child) => find(match, child));
    if (!node || typeof node !== 'object') return [];
    const current = node as Node;
    return [...(match(current) ? [current] : []), ...find(match, current.props.children)];
  };
  const click = async (label: string) => {
    const [button] = find((n) => n.type === 'button' && text(n).includes(label));
    assert.ok(button, 'button ' + label);
    (button.props.onClick as () => void)();
    await settle();
  };
  return { settle, text, find, click };
}

const healthy = async () => ({ ok: true, json: async () => ({ ok: true, today: '2026-10-19' }) });

// The backend-only deploy repository (subtree) has no frontend sources; the umbrella CI runs these.
const frontendMissing = !existsSync(new URL('../../frontend/src/main.tsx', import.meta.url));
const uiTest = frontendMissing ? test.skip : test;

uiTest('the shell shows the app title, navigation and a connected status', async () => {
  const ui = mount(healthy);
  await ui.settle();
  assert.match(ui.text(), /가계부·자산 포트폴리오/);
  assert.ok(ui.find((n) => n.type === 'nav').length === 1);
  const status = ui.find((n) => n.props.role === 'status');
  assert.match(ui.text(status), /서버 연결됨 · 2026-10-19/);
});

uiTest('an unreachable API shows a Korean alert instead of a crash', async () => {
  const ui = mount(async () => {
    throw new Error('offline');
  });
  await ui.settle();
  const alert = ui.find((n) => n.props.role === 'alert');
  assert.match(ui.text(alert), /서버에 연결할 수 없습니다/);
});

uiTest('navigation switches the page heading', async () => {
  const ui = mount(healthy);
  await ui.settle();
  await ui.click('설정');
  assert.match(ui.text(ui.find((n) => n.type === 'h1')), /설정/);
});
