// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
import { afterEach, expect, test } from 'vitest';
import { applyTheme, readTheme, THEME_KEY } from './theme';

afterEach(() => {
  document.documentElement.className = '';
  localStorage.clear();
});

test('a chosen mode sets the html class and is remembered', () => {
  applyTheme('dark');
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  expect(readTheme()).toBe('dark');
  applyTheme('light');
  expect(document.documentElement).toHaveClass('light');
  expect(document.documentElement).not.toHaveClass('dark');
});

test('"system" removes the class and the saved choice', () => {
  applyTheme('dark');
  applyTheme('system');
  expect(document.documentElement.classList.length).toBe(0);
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
  expect(readTheme()).toBe('system');
});

test('an unknown saved value counts as "system"', () => {
  localStorage.setItem(THEME_KEY, 'blue');
  expect(readTheme()).toBe('system');
});
