// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
// Light/dark mode choice (docs/design-system.md "라이트·다크 모드").
// "system" means no class on <html>, so the tokens follow prefers-color-scheme.
// public/theme-init.js applies the saved choice before the first paint with the same key.

import { DARK_ONLY } from './theme-config';

export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_KEY = 'theme';

export function readTheme(): ThemeChoice {
  if (DARK_ONLY) return 'dark';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system'; // storage blocked (private mode, settings)
  }
}

export function applyTheme(choice: ThemeChoice) {
  const html = document.documentElement;
  html.classList.remove('light', 'dark');
  if (choice !== 'system') html.classList.add(choice);
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies for this visit.
  }
}
