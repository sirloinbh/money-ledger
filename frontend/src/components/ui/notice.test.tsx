// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { act, render, renderHook, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { RequestError } from '../../lib/api';
import { errorText, type NoticeValue, useNotice } from '../../lib/use-notice';
import { Notice } from './notice';

// Notices are named variables because the central template renderer reads a double brace as a variable.
const saved: NoticeValue = { kind: 'status', text: 'Saved' };
const failed: NoticeValue = { kind: 'error', text: 'Could not save' };

test('the live regions exist before the first notice, so the first message is announced', () => {
  const { rerender } = render(<Notice notice={undefined} />);
  const status = screen.getByRole('status');
  const alert = screen.getByRole('alert');
  expect(status).toBeEmptyDOMElement();
  expect(alert).toBeEmptyDOMElement();
  rerender(<Notice notice={saved} />);
  // The same elements stay in the page; only their text changes.
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toHaveTextContent('Saved');
  expect(alert).toBeEmptyDOMElement();
});

test('a status message is announced politely and an error at once', () => {
  const { rerender } = render(<Notice notice={saved} />);
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  rerender(<Notice notice={failed} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  rerender(<Notice notice={undefined} />);
  expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
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
