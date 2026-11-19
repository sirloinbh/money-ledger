// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test } from 'vitest';

import { PageHeader } from './page-header';

test('it shows the eyebrow, the h1, the description and the actions', () => {
  render(
    <main>
      <PageHeader eyebrow="Your progress" title="Workout log" description="See how your training flows." actions={<button>Log workout</button>} />
    </main>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Workout log' })).toHaveAttribute('id', 'page-title');
  expect(screen.getByText('Your progress')).toBeInTheDocument();
  expect(screen.getByText('See how your training flows.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Log workout' })).toBeInTheDocument();
  // A plain block, not a second banner landmark next to the app shell's header.
  expect(screen.queryByRole('banner')).toBeNull();
});

test('eyebrow, description and actions are optional and leave no empty elements', () => {
  const { container } = render(<PageHeader title="Goals" />);
  const root = container.querySelector('[data-slot="page-header"]');
  expect(root?.children).toHaveLength(1); // no action group
  expect(root?.querySelectorAll('p')).toHaveLength(0);
});

test('headingRef makes the h1 focusable by script, and id renames it', () => {
  const ref = createRef<HTMLHeadingElement>();
  const { rerender } = render(<PageHeader title="Goals" headingRef={ref} id="goals-title" />);
  const heading = screen.getByRole('heading', { level: 1 });
  expect(ref.current).toBe(heading);
  expect(heading).toHaveAttribute('tabindex', '-1');
  expect(heading).toHaveAttribute('id', 'goals-title');
  rerender(<PageHeader title="Goals" />);
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('tabindex');
});
