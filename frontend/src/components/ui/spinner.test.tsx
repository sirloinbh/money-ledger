// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Button } from './button';
import { Spinner } from './spinner';

test('the spinner is a named status in three sizes', () => {
  render(
    <>
      <Spinner size="sm" />
      <Spinner label="Saving" />
      <Spinner size="lg" label="Large spinner" />
    </>,
  );
  expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('size-4');
  expect(screen.getByRole('status', { name: 'Saving' })).toHaveClass('size-6');
  expect(screen.getByRole('status', { name: 'Large spinner' })).toHaveClass('size-8', 'motion-reduce:animate-none');
});

test('a saving button shows the spinner and stays named', () => {
  render(
    <Button disabled>
      <Spinner size="sm" label="Saving" />
      Save
    </Button>,
  );
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  expect(screen.getByRole('status', { name: 'Saving' })).toBeInTheDocument();
});
