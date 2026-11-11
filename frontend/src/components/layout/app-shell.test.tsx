// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/layout/에서
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HomeIcon, NotebookPenIcon } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';

import { DARK_ONLY } from '../../lib/theme-config';
import { AppShell, type NavItem } from './app-shell';

const nav: NavItem[] = [
  { to: '/', label: 'Overview', icon: HomeIcon },
  { to: '/journal', label: 'Journal', icon: NotebookPenIcon },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell appName="Sample App" nav={nav}>
        <h1>Page</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

afterEach(() => {
  document.documentElement.className = '';
  localStorage.clear();
});

test('the frame has a skip link, the app name, a main region and a footer', () => {
  renderAt('/');
  expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main');
  expect(screen.getByRole('link', { name: 'Sample App' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1, name: 'Page' }));
  expect(screen.getByRole('contentinfo')).toHaveTextContent('Sample App');
});

test('the sidebar menu marks the current page', () => {
  renderAt('/journal');
  const menu = screen.getByRole('navigation', { name: 'Main menu' });
  expect(within(menu).getByRole('link', { name: 'Journal' })).toHaveAttribute('aria-current', 'page');
  expect(within(menu).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
});

test('the menu button opens the menu as a sheet, and choosing a page closes it', () => {
  renderAt('/');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const sheet = screen.getByRole('dialog', { name: 'Sample App' });
  fireEvent.click(within(sheet).getByRole('link', { name: 'Journal' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('link', { name: 'Journal' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test.skipIf(DARK_ONLY)('the mode menu switches to dark and remembers it', () => {
  renderAt('/');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Theme: System' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('theme')).toBe('dark');
  expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument();
});

test.runIf(DARK_ONLY)('a dark-only app has no mode menu', () => {
  renderAt('/');
  expect(screen.queryByRole('button', { name: /Theme/ })).toBeNull();
});
