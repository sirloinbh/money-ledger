// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { InboxIcon } from 'lucide-react';
import { expect, test } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';

test('an empty state names the situation and offers the next step', () => {
  render(
    <EmptyState
      icon={<InboxIcon />}
      title="No entries yet"
      description="Record your first workout."
      action={<Button>Add entry</Button>}
    />,
  );
  expect(screen.getByRole('heading', { level: 2, name: 'No entries yet' })).toBeInTheDocument();
  expect(screen.getByText('Record your first workout.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument();
});

test('the heading level can follow the page, and the icon is decorative', () => {
  const { container } = render(<EmptyState title="No results" headingLevel="h3" icon={<InboxIcon />} />);
  expect(screen.getByRole('heading', { level: 3, name: 'No results' })).toBeInTheDocument();
  expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
});
