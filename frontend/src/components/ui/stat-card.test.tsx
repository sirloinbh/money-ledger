// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { StatCard } from './stat-card';

test('it shows the label, the value with its unit, and the note', () => {
  render(
    <StatCard
      label="Total volume"
      value="1,500"
      unit="kg"
      icon={<svg aria-hidden="true" />}
      foot="Total weight × reps"
    />,
  );

  expect(screen.getByText('Total volume')).toBeInTheDocument();
  expect(screen.getByText('kg').parentElement).toHaveTextContent('1,500kg');
  expect(screen.getByText('Total weight × reps')).toBeInTheDocument();
});
