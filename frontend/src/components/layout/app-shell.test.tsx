// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/layout/에서
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HomeIcon, NotebookPenIcon } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';

import { AppShell, type NavItem } from './app-shell';

const nav: NavItem[] = [
  { to: '/', label: '개요', icon: HomeIcon },
  { to: '/journal', label: '일지', icon: NotebookPenIcon },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell appName="샘플 앱" nav={nav}>
        <h1>페이지</h1>
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
  expect(screen.getByRole('link', { name: '본문으로 건너뛰기' })).toHaveAttribute('href', '#main');
  expect(screen.getByRole('link', { name: '샘플 앱' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1, name: '페이지' }));
  expect(screen.getByRole('contentinfo')).toHaveTextContent('샘플 앱');
});

test('the sidebar menu marks the current page', () => {
  renderAt('/journal');
  const menu = screen.getByRole('navigation', { name: '주 메뉴' });
  expect(within(menu).getByRole('link', { name: '일지' })).toHaveAttribute('aria-current', 'page');
  expect(within(menu).getByRole('link', { name: '개요' })).not.toHaveAttribute('aria-current');
});

test('the menu button opens the menu as a sheet, and choosing a page closes it', () => {
  renderAt('/');
  fireEvent.click(screen.getByRole('button', { name: '메뉴 열기' }));
  const sheet = screen.getByRole('dialog', { name: '샘플 앱' });
  fireEvent.click(within(sheet).getByRole('link', { name: '일지' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', { name: '일지' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the mode menu switches to dark and remembers it', () => {
  renderAt('/');
  fireEvent.keyDown(screen.getByRole('button', { name: '화면 모드: 시스템 설정' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitemradio', { name: '다크' }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('theme')).toBe('dark');
  expect(screen.getByRole('button', { name: '화면 모드: 다크' })).toBeInTheDocument();
});
