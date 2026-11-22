import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reports a change a section made itself (#198). The section reloads by itself after the change (for its
 * status message), so the version bump the parent sends back must not load the same list a second time.
 *
 * `versions` names the version props the reload effect depends on (for example `"3:7"`). `notifyChange`
 * remembers them, calls `onChange` and re-renders this section in the same batch as the parent's update.
 * The commit of that batch decides once: the versions moved (the parent bumped one), so the next reload
 * effect run is skipped (`takeSkip()` returns true); or they did not, so nothing is skipped. Either way the
 * token is spent there, so a parent that calls `onChange` without bumping a version cannot leave a skip
 * behind that swallows a later real reload.
 *
 * Call `takeSkip()` in the reload effect on every run; this hook must be called before that effect.
 */
export function useOwnChange(onChange: (() => void) | undefined, versions: string) {
  // The versions when this section reported its change; undefined when no change is waiting.
  const changedAt = useRef<string | undefined>(undefined);
  const latestVersions = useRef(versions);
  const skipNext = useRef(false);
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    latestVersions.current = versions;
    if (changedAt.current === undefined) return;
    skipNext.current = changedAt.current !== versions;
    changedAt.current = undefined;
  }, [versions, changes]);

  const notifyChange = useCallback(() => {
    if (!onChange) return;
    changedAt.current = latestVersions.current;
    setChanges((count) => count + 1);
    onChange();
  }, [onChange]);

  const takeSkip = useCallback(() => {
    const skip = skipNext.current;
    skipNext.current = false;
    return skip;
  }, []);

  return { notifyChange, takeSkip };
}
