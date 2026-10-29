// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Badge } from './badge';

test('badge variants use the shared colour tokens', () => {
  render(
    <>
      <Badge>기본</Badge>
      <Badge variant="warning">주의</Badge>
      <Badge variant="outline">보조</Badge>
    </>,
  );
  expect(screen.getByText('기본')).toHaveClass('bg-primary');
  expect(screen.getByText('주의')).toHaveClass('bg-warning', 'text-warning-foreground');
  expect(screen.getByText('보조')).toHaveClass('text-foreground');
});

test('asChild turns a badge into a link', () => {
  render(
    <Badge asChild>
      <a href="/tags/legs">하체</a>
    </Badge>,
  );
  expect(screen.getByRole('link', { name: '하체' })).toHaveAttribute('data-slot', 'badge');
});
