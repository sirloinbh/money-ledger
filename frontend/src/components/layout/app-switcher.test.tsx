// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/layout/
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';

import { APPS, CURRENT_APP } from '../../lib/apps';
import { AppSwitcher } from './app-switcher';

// APPS is filled in from the registry at sync time, so the checks follow whatever list this app received.
test.skipIf(APPS.length < 2)('the menu lists every app as a link and marks the current one', () => {
  render(<AppSwitcher />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Switch app' }), { key: 'Enter' });
  const menu = screen.getByRole('menu');
  for (const { label, href } of APPS) {
    expect(within(menu).getByRole('menuitem', { name: label })).toHaveAttribute('href', href);
  }
  expect(APPS.map((app) => app.name)).toContain(CURRENT_APP);
  const current = APPS.find((app) => app.name === CURRENT_APP);
  expect(within(menu).getByRole('menuitem', { name: current?.label })).toHaveAttribute('aria-current', 'page');
});

test.skipIf(APPS.length >= 2)('the menu is hidden when there is no other app', () => {
  render(<AppSwitcher />);
  expect(screen.queryByRole('button', { name: 'Switch app' })).toBeNull();
});
