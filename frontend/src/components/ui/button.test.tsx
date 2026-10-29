// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { Button } from './button';

test('a button is reachable by its name and reports clicks', () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>저장</Button>);
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(onClick).toHaveBeenCalledOnce();
});

test('a disabled button ignores clicks', () => {
  const onClick = vi.fn();
  render(
    <Button disabled onClick={onClick}>
      저장
    </Button>,
  );
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(onClick).not.toHaveBeenCalled();
});

test('variants and sizes change the classes, and touch screens get 44px', () => {
  render(
    <>
      <Button variant="destructive">삭제</Button>
      <Button variant="outline" size="icon" aria-label="닫기" />
    </>,
  );
  expect(screen.getByRole('button', { name: '삭제' })).toHaveClass('bg-destructive', 'pointer-coarse:min-h-11');
  expect(screen.getByRole('button', { name: '닫기' })).toHaveClass('border', 'pointer-coarse:size-11');
});

test('asChild renders the child element, e.g. a link', () => {
  render(
    <Button asChild>
      <a href="/journal">일지</a>
    </Button>,
  );
  expect(screen.getByRole('link', { name: '일지' })).toHaveAttribute('data-slot', 'button');
});
