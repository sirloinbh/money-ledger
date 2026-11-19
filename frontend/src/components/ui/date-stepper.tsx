// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';
import { Input } from './input';

// #224: the anchor date of a period, with optional previous/next buttons around it.
// Without onMove only the date input is shown (e.g. a page that only picks a date).
export function DateStepper({
  label,
  value,
  onValueChange,
  onMove,
  previousLabel = 'Previous period',
  nextLabel = 'Next period',
  className,
}: {
  label: string;
  value: string;
  onValueChange: (date: string) => void;
  onMove?: (direction: -1 | 1) => void;
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  return (
    <div data-slot="date-stepper" className={cn('flex items-center gap-1', className)}>
      {onMove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={previousLabel}
          className="text-muted-foreground"
          onClick={() => onMove(-1)}
        >
          <ChevronLeft />
        </Button>
      )}
      <Input
        aria-label={label}
        type="date"
        className="w-36 md:pointer-coarse:text-base"
        value={value}
        // Clearing the input keeps the current date: a period always needs an anchor.
        onChange={(e) => e.target.value && onValueChange(e.target.value)}
      />
      {onMove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={nextLabel}
          className="text-muted-foreground"
          onClick={() => onMove(1)}
        >
          <ChevronRight />
        </Button>
      )}
    </div>
  );
}

// #224: the chosen period's first and last day with a short note after it.
export function RangeSummary({
  from,
  to,
  children,
  className,
}: {
  from: string;
  to: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p data-slot="range-summary" className={cn('mt-4 mb-5 text-xs text-foreground', className)}>
      {from} — {to}
      {children && ' '}
      {children && <span className="ml-2.5 text-muted-foreground">{children}</span>}
    </p>
  );
}
