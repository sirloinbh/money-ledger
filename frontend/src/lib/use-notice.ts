// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
import { useCallback, useMemo, useState } from 'react';

// One message on the screen at a time: progress or success ("status") or a failure ("error") (#311).
// Show it with <Notice notice={notice} /> from components/ui/notice.

export type NoticeValue = { kind: 'status' | 'error'; text: string };

/** The message of anything a request threw (RequestError from lib/api carries the server's Korean text). */
export function errorText(error: unknown, fallback = '요청을 처리하지 못했습니다') {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useNotice() {
  const [notice, setNotice] = useState<NoticeValue | undefined>(undefined);
  const status = useCallback((text: string) => setNotice({ kind: 'status', text }), []);
  const error = useCallback((cause: unknown, fallback?: string) => setNotice({ kind: 'error', text: typeof cause === 'string' ? cause : errorText(cause, fallback) }), []);
  const clear = useCallback(() => setNotice(undefined), []);
  return useMemo(() => ({ notice, status, error, clear }), [notice, status, error, clear]);
}
