// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Badge } from './badge';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

test('a card shows its parts, and the title heading level follows the page', () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">This week</CardTitle>
        <CardDescription>4 workouts</CardDescription>
        <CardAction>
          <Badge variant="success">Goal reached</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>Content</CardContent>
      <CardFooter>Footer</CardFooter>
    </Card>,
  );
  expect(screen.getByRole('heading', { level: 2, name: 'This week' })).toBeInTheDocument();
  expect(screen.getByText('4 workouts')).toHaveClass('text-muted-foreground');
  expect(screen.getByText('Goal reached')).toHaveClass('bg-success');
});

test('the card title is an h3 unless told otherwise', () => {
  render(<CardTitle>Entries</CardTitle>);
  expect(screen.getByRole('heading', { level: 3, name: 'Entries' })).toBeInTheDocument();
});
