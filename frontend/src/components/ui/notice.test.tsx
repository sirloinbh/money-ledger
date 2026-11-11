// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import { act, render, renderHook, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { RequestError } from '../../lib/api';
import { errorText, type NoticeValue, useNotice } from '../../lib/use-notice';
import { Notice } from './notice';

// Notices are named variables because the central template renderer reads a double brace as a variable.
const saved: NoticeValue = { kind: 'status', text: 'Saved' };
const failed: NoticeValue = { kind: 'error', text: 'Could not save' };

test('a status message is announced politely and an error at once', () => {
  const { rerender } = render(<Notice notice={saved} />);
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  rerender(<Notice notice={failed} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  rerender(<Notice notice={undefined} />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test('useNotice shows progress, the error a request threw, and clears', () => {
  const { result } = renderHook(() => useNotice());
  act(() => result.current.status('Saving…'));
  expect(result.current.notice).toEqual({ kind: 'status', text: 'Saving…' });
  act(() => result.current.error(new RequestError('Textbook not found', 404)));
  expect(result.current.notice).toEqual({ kind: 'error', text: 'Textbook not found' });
  act(() => result.current.error('custom text'));
  expect(result.current.notice).toEqual({ kind: 'error', text: 'custom text' });
  act(() => result.current.clear());
  expect(result.current.notice).toBeUndefined();
});

test('errorText falls back for values that are not errors', () => {
  expect(errorText(new Error('Connection failed'))).toBe('Connection failed');
  expect(errorText({ message: 'not an Error' })).toBe('Could not process the request');
  expect(errorText(undefined, 'Could not load')).toBe('Could not load');
});
