// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { act, render, renderHook, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { RequestError } from '../../lib/api';
import { errorText, type NoticeValue, useNotice } from '../../lib/use-notice';
import { Notice } from './notice';

// Notices are named variables because the central template renderer reads a double brace as a variable.
const saved: NoticeValue = { kind: 'status', text: '저장했습니다' };
const failed: NoticeValue = { kind: 'error', text: '저장하지 못했습니다' };

test('a status message is announced politely and an error at once', () => {
  const { rerender } = render(<Notice notice={saved} />);
  expect(screen.getByRole('status')).toHaveTextContent('저장했습니다');
  rerender(<Notice notice={failed} />);
  expect(screen.getByRole('alert')).toHaveTextContent('저장하지 못했습니다');
  rerender(<Notice notice={undefined} />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test('useNotice shows progress, the error a request threw, and clears', () => {
  const { result } = renderHook(() => useNotice());
  act(() => result.current.status('저장하는 중…'));
  expect(result.current.notice).toEqual({ kind: 'status', text: '저장하는 중…' });
  act(() => result.current.error(new RequestError('교재를 찾을 수 없습니다', 404)));
  expect(result.current.notice).toEqual({ kind: 'error', text: '교재를 찾을 수 없습니다' });
  act(() => result.current.error('직접 쓴 문구'));
  expect(result.current.notice).toEqual({ kind: 'error', text: '직접 쓴 문구' });
  act(() => result.current.clear());
  expect(result.current.notice).toBeUndefined();
});

test('errorText falls back for values that are not errors', () => {
  expect(errorText(new Error('연결 실패'))).toBe('연결 실패');
  expect(errorText({ message: 'not an Error' })).toBe('요청을 처리하지 못했습니다');
  expect(errorText(undefined, '불러오지 못했습니다')).toBe('불러오지 못했습니다');
});
