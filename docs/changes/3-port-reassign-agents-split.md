# #3 포트를 중앙 표준(슬롯 05)으로 바꾸고 AGENTS 고유 규칙 분리

- 이슈: https://github.com/sirloinbh/money-ledger/issues/3
- 중앙 추적 이슈: https://github.com/sirloinbh/project-standards/issues/99

## 목적

- 8개 앱의 포트가 서로 겹치지 않도록 중앙 레지스트리가 다시 배정한 포트를 적용한다(project-standards ADR-0006).
- 중앙 표준 첫 동기화가 AGENTS.md를 공통 지침으로 바꾸기 전에, 이 프로젝트의 PR 리뷰·병합 규칙을 AGENTS.project.md로 옮겨 보존한다.

## 변경

| 종류              | 이전  | 이후      |
| ----------------- | ----- | --------- |
| 웹                | 8095  | 8105      |
| API               | 3015  | 3105      |
| Vite              | 5175  | 5205      |
| 호스트 DB         | 55445 | 15405     |
| e2e API·웹 (예약) | 없음  | 3205·5305 |

- 포트를 바꾼 파일: `.env.example`, `README.md`, `backend/Dockerfile`, `backend/src/server.ts`, `compose.yaml`, `frontend/nginx.conf`, `frontend/vite.config.ts`, `AGENTS.md`
- `AGENTS.md`의 절차 5번(자동 코드 리뷰·병합 규칙)을 문구 그대로 `AGENTS.project.md`의 "작업 절차"로 옮기고, `AGENTS.md`는 그 파일을 반드시 읽게 했다.
- `docs/changes/`, `docs/daily/`, `docs/next-steps/`의 과거 기록은 당시 상태라서 고치지 않았다.

## 사용자가 할 일

- 로컬 `.env`의 `DATABASE_URL` 포트를 `55445`에서 `15405`로, `PORT`를 `3015`에서 `3105`로 바꾼다. `.env`는 커밋하지 않는다.

## 검증

- 2026-10-22: 결과는 PR 본문에 적는다.
