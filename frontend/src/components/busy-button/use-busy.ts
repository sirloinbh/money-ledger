// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/busy-button/
import { useCallback, useRef, useState } from 'react';

/**
 * One request at a time, with keyboard focus kept (#10).
 *
 * `run(task)` starts the task unless one is already running (then it returns `undefined` at once, so a double click
 * or a second Enter does nothing). `busy` is true while it runs. It remembers the focused element when the task starts
 * and, when the task ends and focus fell to the page (because the button was disabled or the block re-rendered),
 * gives focus back to that element if it is still on the page.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(async <T>(task: () => Promise<T> | T): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      return await task();
    } finally {
      running.current = false;
      setBusy(false);
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && origin?.isConnected) origin.focus();
    }
  }, []);

  return { busy, run };
}
