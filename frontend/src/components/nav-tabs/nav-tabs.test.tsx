// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/nav-tabs/
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';

import { NavTabs } from './nav-tabs';

const items = [
  { to: '/items', label: 'All', end: true },
  { to: '/items/books', label: 'Books' },
  { to: '/items/music', label: 'Music' },
];

test('it is a named navigation with one link per tab, and the current page is marked', () => {
  render(
    <MemoryRouter initialEntries={['/items/books']}>
      <NavTabs label="Categories" items={items} />
    </MemoryRouter>,
  );
  const nav = screen.getByRole('navigation', { name: 'Categories' });
  expect(nav).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(3);
  expect(screen.getByRole('link', { name: 'Books' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
});

test('end keeps the parent tab from matching its children', () => {
  render(
    <MemoryRouter initialEntries={['/items']}>
      <NavTabs label="Categories" items={items} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Books' })).not.toHaveAttribute('aria-current');
});

test('tabs keep the touch height and the pointer cursor, and the row scrolls instead of wrapping', () => {
  render(
    <MemoryRouter initialEntries={['/items']}>
      <NavTabs label="Categories" items={items} className="mt-2" />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Music' })).toHaveClass(
    'min-h-11',
    'pointer-coarse:min-h-12',
    'cursor-pointer',
  );
  expect(screen.getByRole('navigation')).toHaveClass('overflow-x-auto', 'mt-2');
});
