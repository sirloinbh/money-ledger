import type { ReactNode } from 'react';

import { EmptyState } from './components/ui/empty-state';
import { type Health, healthText } from './health';

export function Page({
  title,
  description,
  health,
  emptyDescription,
  children,
}: {
  title: string;
  description: string;
  health: Health;
  emptyDescription?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 id="page-title">{title}</h1>
        <p className="text-body text-muted-foreground">{description}</p>
        {health.state === 'error' ? (
          <p role="alert" className="text-body-sm text-destructive">
            {healthText(health)}
          </p>
        ) : (
          <p role="status" className="text-caption text-muted-foreground">
            {healthText(health)}
          </p>
        )}
      </header>
      {children ?? <EmptyState title="No features yet" description={emptyDescription} />}
    </section>
  );
}
