// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/load-state/
import { type ReactNode, useLayoutEffect, useRef } from 'react';

import { cn } from '../../lib/utils';
import { AlertBanner } from '../ui/alert-banner';
import { Button } from '../ui/button';
import { SkeletonCard, SkeletonList } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';

// The loading and failure states of a page or a block (#9), so every app loads and fails the same way
// (docs/guidelines.md, "Loading" and "Empty and error"): a Skeleton of the real shape while the first load runs, and a
// named failure message with a retry that keeps keyboard focus.

type LoadingShape = 'rows' | 'card' | 'cards';

/**
 * A named region that shows a Skeleton in the shape of the real content. It is `aria-busy` and announces its `label`
 * ("Loading entries") politely; the placeholder shapes are hidden from screen readers.
 */
function LoadingRegion({
  label,
  shape = 'rows',
  rows = 3,
  className,
}: {
  /** What is loading, for example "Loading entries". */
  label: string;
  shape?: LoadingShape;
  /** Number of rows (shape "rows") or cards (shape "cards"). */
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-slot="loading-region"
      className={className}
    >
      {shape === 'rows' && <SkeletonList rows={rows} />}
      {shape === 'card' && <SkeletonCard />}
      {shape === 'cards' && (
        <div className="flex flex-col gap-4">
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
    </div>
  );
}

const FOCUS_REGION =
  '[role="region"][aria-label], [role="region"][aria-labelledby], section[aria-label], section[aria-labelledby], [data-focus-region]';

/**
 * "Try again". While the retry runs (`pending`) it shows a Spinner and stays focusable (`aria-disabled`, not
 * `disabled`), so keyboard focus is not lost. When the button leaves the page while it has focus (the failure message
 * is replaced by the loaded content), focus moves to the nearest named region around it, then to `<main>`.
 */
function RetryButton({
  onRetry,
  pending = false,
  children = 'Try again',
  className,
}: {
  onRetry: () => void;
  pending?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    if (!button) return;
    return () => {
      if (document.activeElement !== button) return;
      const target =
        button.parentElement?.closest<HTMLElement>(FOCUS_REGION) ??
        document.querySelector<HTMLElement>('main');
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
    };
  }, []);
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      aria-disabled={pending || undefined}
      className={className}
      onClick={() => {
        if (!pending) onRetry();
      }}
    >
      {pending && <Spinner size="sm" label="Trying again" />}
      {children}
    </Button>
  );
}

/** A failed load: what failed, then a retry. `message` should say what could not be loaded and why when known. */
function LoadFailed({
  message,
  onRetry,
  pending,
  retryLabel,
  className,
}: {
  message: ReactNode;
  /** Leave out when retrying cannot help; the message is then shown alone. */
  onRetry?: () => void;
  pending?: boolean;
  retryLabel?: ReactNode;
  className?: string;
}) {
  return (
    <AlertBanner
      data-slot="load-failed"
      className={cn(className)}
      action={
        onRetry && (
          <RetryButton onRetry={onRetry} pending={pending}>
            {retryLabel}
          </RetryButton>
        )
      }
    >
      {message}
    </AlertBanner>
  );
}

export { LoadFailed, LoadingRegion, RetryButton };
