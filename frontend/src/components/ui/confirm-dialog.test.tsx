// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { expect, test, vi } from 'vitest';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';

function deferred() {
  let resolve = () => {};
  let reject = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = () => rej(new Error('삭제하지 못했습니다'));
  });
  return { promise, resolve, reject };
}

test('the trigger opens a named dialog; confirming runs the action and closes it', () => {
  const onConfirm = vi.fn();
  render(<ConfirmDialog title="기록을 삭제할까요?" description="삭제하면 되돌릴 수 없습니다." onConfirm={onConfirm} trigger={<Button>삭제하기</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: '삭제하기' }));
  const dialog = screen.getByRole('dialog', { name: '기록을 삭제할까요?' });
  expect(dialog).toHaveAccessibleDescription('삭제하면 되돌릴 수 없습니다.');
  expect(screen.getByRole('button', { name: '삭제' })).toHaveAttribute('data-slot', 'button');
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('cancel closes without running the action', () => {
  const onConfirm = vi.fn();
  render(<ConfirmDialog title="목표를 삭제할까요?" onConfirm={onConfirm} trigger={<Button>삭제하기</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: '삭제하기' }));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('while the action runs the buttons wait; the dialog closes when it succeeds', async () => {
  const work = deferred();
  render(<ConfirmDialog title="삭제할까요?" onConfirm={() => work.promise} trigger={<Button>열기</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: '열기' }));
  fireEvent.click(screen.getByRole('button', { name: /삭제/ }));
  expect(screen.getByRole('button', { name: /삭제/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  expect(screen.getByRole('status', { name: '처리하는 중' })).toBeInTheDocument();
  work.resolve();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('a failed action leaves the dialog open so the screen can show why', async () => {
  const work = deferred();
  render(<ConfirmDialog title="삭제할까요?" onConfirm={() => work.promise} trigger={<Button>열기</Button>} />);
  fireEvent.click(screen.getByRole('button', { name: '열기' }));
  fireEvent.click(screen.getByRole('button', { name: /삭제/ }));
  work.reject();
  await waitFor(() => expect(screen.getByRole('button', { name: '삭제' })).toBeEnabled());
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('it can be controlled, e.g. opened for the row the user picked', () => {
  function Rows() {
    const [target, setTarget] = React.useState<string | null>(null);
    return (
      <>
        <Button onClick={() => setTarget('3월 2일')}>3월 2일 삭제</Button>
        <ConfirmDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)} title={`${target ?? ''} 기록을 삭제할까요?`} confirmLabel="지우기" destructive={false} onConfirm={() => setTarget(null)} />
      </>
    );
  }
  render(<Rows />);
  fireEvent.click(screen.getByRole('button', { name: '3월 2일 삭제' }));
  expect(screen.getByRole('dialog', { name: '3월 2일 기록을 삭제할까요?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '지우기' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
