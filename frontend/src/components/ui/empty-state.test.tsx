// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { InboxIcon } from 'lucide-react';
import { expect, test } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';

test('an empty state names the situation and offers the next step', () => {
  render(
    <EmptyState
      icon={<InboxIcon />}
      title="아직 기록이 없습니다"
      description="첫 운동을 기록해 보세요."
      action={<Button>기록 추가</Button>}
    />,
  );
  expect(screen.getByRole('heading', { level: 2, name: '아직 기록이 없습니다' })).toBeInTheDocument();
  expect(screen.getByText('첫 운동을 기록해 보세요.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '기록 추가' })).toBeInTheDocument();
});

test('the heading level can follow the page, and the icon is decorative', () => {
  const { container } = render(<EmptyState title="결과 없음" headingLevel="h3" icon={<InboxIcon />} />);
  expect(screen.getByRole('heading', { level: 3, name: '결과 없음' })).toBeInTheDocument();
  expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
});
