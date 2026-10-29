// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, test } from 'vitest';

import { toast, Toaster } from './sonner';

// jsdom has no matchMedia; sonner reads it to follow the system theme.
beforeAll(() => {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  document.documentElement.className = '';
  act(() => {
    toast.dismiss();
  });
});

test('a toast message appears in the notification region', async () => {
  render(<Toaster />);
  act(() => {
    toast.success('저장했습니다');
  });
  expect(await screen.findByText('저장했습니다')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: /알림/ })).toBeInTheDocument();
});

test('the toaster follows the html light/dark class', async () => {
  document.documentElement.classList.add('dark');
  render(<Toaster />);
  act(() => {
    toast('확인');
  });
  await screen.findByText('확인');
  expect(document.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark');
});
