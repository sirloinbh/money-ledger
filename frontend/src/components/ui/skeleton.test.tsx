// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Skeleton, SkeletonCard, SkeletonList, SkeletonText } from './skeleton';

test('skeletons are hidden from screen readers and stop moving for reduced motion', () => {
  const { container } = render(<Skeleton className="h-4" />);
  const block = container.querySelector('[data-slot="skeleton"]');
  expect(block).toHaveAttribute('aria-hidden', 'true');
  expect(block).toHaveClass('animate-pulse', 'motion-reduce:animate-none');
});

test('text, card and list shapes draw the expected number of blocks', () => {
  render(
    <section aria-busy="true" aria-label="기록 불러오는 중">
      <div data-testid="text">
        <SkeletonText lines={4} />
      </div>
      <div data-testid="card">
        <SkeletonCard />
      </div>
      <div data-testid="list">
        <SkeletonList rows={2} />
      </div>
    </section>,
  );
  const blocks = (id: string) => screen.getByTestId(id).querySelectorAll('[data-slot="skeleton"]').length;
  expect(blocks('text')).toBe(4);
  expect(blocks('card')).toBe(1 + 2);
  expect(blocks('list')).toBe(2 * 3);
  expect(screen.getByRole('region', { name: '기록 불러오는 중' })).toHaveAttribute('aria-busy', 'true');
});
