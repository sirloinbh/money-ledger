// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/list/
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';

import { List, ListItem, ListItemActions } from './list';

test('a list has items, and the actions sit at the end of the row', () => {
  render(
    <List aria-label="Workouts">
      <ListItem>
        Bench press
        <ListItemActions>
          <button type="button">Edit</button>
        </ListItemActions>
      </ListItem>
      <ListItem>Squat</ListItem>
    </List>,
  );
  const list = screen.getByRole('list', { name: 'Workouts' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Edit' }).parentElement).toHaveClass('ml-auto');
});

test('rows keep the 44px height (48px on touch) and className passes through', () => {
  render(
    <List className="mt-4" data-testid="list">
      <ListItem className="font-semibold">One</ListItem>
    </List>,
  );
  expect(screen.getByTestId('list')).toHaveClass('mt-4', 'divide-y');
  expect(screen.getByRole('listitem')).toHaveClass(
    'min-h-11',
    'pointer-coarse:min-h-12',
    'font-semibold',
  );
});
