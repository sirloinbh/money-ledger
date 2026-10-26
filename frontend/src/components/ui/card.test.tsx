// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Badge } from './badge';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

test('a card shows its parts, and the title heading level follows the page', () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">이번 주</CardTitle>
        <CardDescription>운동 4회</CardDescription>
        <CardAction>
          <Badge variant="success">목표 달성</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>내용</CardContent>
      <CardFooter>바닥</CardFooter>
    </Card>,
  );
  expect(screen.getByRole('heading', { level: 2, name: '이번 주' })).toBeInTheDocument();
  expect(screen.getByText('운동 4회')).toHaveClass('text-muted-foreground');
  expect(screen.getByText('목표 달성')).toHaveClass('bg-success');
});

test('the card title is an h3 unless told otherwise', () => {
  render(<CardTitle>기록</CardTitle>);
  expect(screen.getByRole('heading', { level: 3, name: '기록' })).toBeInTheDocument();
});
