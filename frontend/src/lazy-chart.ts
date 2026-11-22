import { type ComponentType, createElement, lazy } from 'react';

// #202 The charts' shared parts. Recharts is large, so each chart is in its own file and loads when there is
// something to draw (#40). One boundary handles both ways a chart can fail: the file not loading (an old tab after
// a deploy, offline), which is worth loading again, and an error while drawing, which is logged so it is found.

/** The chart file did not load. Only this failure starts a new download. */
export class ChartLoadError extends Error {
  constructor(cause: unknown) {
    super('The chart file did not load', { cause });
    this.name = 'ChartLoadError';
  }
}

export type LazyChart<P extends object> = {
  /** Renders the chart, loading its file the first time. */
  Chart: ComponentType<P>;
  /** Forgets a failed download, so the next render loads the file again (`lazy` keeps a failure). */
  reload: () => void;
};

/** A chart loaded from its own file. `load` imports the file and picks the component. */
export function lazyChart<P extends object>(load: () => Promise<ComponentType<P>>): LazyChart<P> {
  const make = () =>
    lazy(() =>
      load().then(
        (Chart) => ({ default: Chart }),
        (error: unknown) => {
          throw new ChartLoadError(error);
        },
      ),
    );
  let Loaded = make();
  function Chart(props: P) {
    return createElement(Loaded, props);
  }
  return {
    Chart,
    reload: () => {
      Loaded = make();
    },
  };
}

/**
 * About how many 12px Latin characters fit on an 88px axis. A wide character (Hangul, CJK) counts as two.
 * The tooltip and the table show the whole name.
 */
const axisNameUnits = 13;

// Hangul and CJK characters are about as wide as the font size.
const wide = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const units = (char: string) => (wide.test(char) ? 2 : 1);

/** A name cut to fit the category axis, with "…" when cut. */
export function axisName(name: string, limit = axisNameUnits) {
  const chars = [...name];
  if (chars.reduce((sum, char) => sum + units(char), 0) <= limit) return name;
  let used = 1; // the "…"
  let cut = '';
  for (const char of chars) {
    if (used + units(char) > limit) break;
    used += units(char);
    cut += char;
  }
  return `${cut}…`;
}
