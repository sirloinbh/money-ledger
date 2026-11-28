// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { useEffect, useState } from 'react';

// How many pixels at the bottom of the layout viewport the on-screen keyboard covers, so a dialog stuck to the bottom
// edge can move up and keep its fields visible. Zero when the browser has no visualViewport, when `active` is false,
// or when no keyboard is open. It listens only while active.
export function useKeyboardInset(active = true): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!active || !viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setInset(0);
    };
  }, [active]);
  return inset;
}
