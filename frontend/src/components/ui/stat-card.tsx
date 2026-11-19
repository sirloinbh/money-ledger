// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import type { ReactNode } from 'react';

import { Card } from './card';

// One summary number in a row of cards: a label, the value with its unit, and a short note.
export function StatCard({
  label,
  value,
  unit,
  icon,
  foot,
}: {
  label: string;
  value: string;
  unit: string;
  icon: ReactNode;
  foot: string;
}) {
  return (
    <Card data-slot="stat" className="gap-3 p-4 shadow-none xl:p-5">
      <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
        {label}
        <span className="flex rounded-md bg-muted p-1.5 text-foreground">{icon}</span>
      </div>
      <div
        data-slot="stat-value"
        className="text-2xl font-medium tracking-tight break-words xl:text-3xl"
      >
        {value}
        <small className="ml-1.5 text-caption tracking-normal text-muted-foreground">{unit}</small>
      </div>
      <div className="text-meta text-muted-foreground">{foot}</div>
    </Card>
  );
}
