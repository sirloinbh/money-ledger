// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Button } from './button';
import { Spinner } from './spinner';

test('the spinner is a named status in three sizes', () => {
  render(
    <>
      <Spinner size="sm" />
      <Spinner label="저장하는 중" />
      <Spinner size="lg" label="큰 스피너" />
    </>,
  );
  expect(screen.getByRole('status', { name: '불러오는 중' })).toHaveClass('size-4');
  expect(screen.getByRole('status', { name: '저장하는 중' })).toHaveClass('size-6');
  expect(screen.getByRole('status', { name: '큰 스피너' })).toHaveClass('size-8', 'motion-reduce:animate-none');
});

test('a saving button shows the spinner and stays named', () => {
  render(
    <Button disabled>
      <Spinner size="sm" label="저장하는 중" />
      저장
    </Button>,
  );
  expect(screen.getByRole('button', { name: /저장/ })).toBeDisabled();
  expect(screen.getByRole('status', { name: '저장하는 중' })).toBeInTheDocument();
});
