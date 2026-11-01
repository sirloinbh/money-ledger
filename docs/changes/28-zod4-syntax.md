# #28 백엔드 검증 코드를 zod 4 문법으로 옮기기

- 이슈: [#28](https://github.com/sirloinbh/money-ledger/issues/28)
- 브랜치: `chore/28-zod4-syntax`

## 목적

중앙 `sirloinbh/project-standards#386`의 1단계다. 중앙이 `zod`를 4.6.7로 올릴 때 이 앱이 깨지지 않도록 코드를 먼저 옮긴다. 보안 권고 GHSA-mrhx-c7xc-m3w5의 Dependabot 알림은 그 동기화로 닫힌다. 이 PR만으로는 닫히지 않는다.

## 변경 — 2026-11-01

- `backend/src/app.ts`의 `ZodError`를 `zod/v4`에서 불러온다. 설치된 3.25.76에 이 경로가 들어 있어 설치와 잠금 파일은 바꾸지 않았다.
- 이 앱에는 아직 zod 스키마가 없어 `z.record`, `.default()`, `z.array`를 살필 곳이 없다.
- zod 4 스키마의 오류가 400과 그 메시지로 응답되는지 확인하는 테스트를 `backend/test/health.test.ts`에 넣었다.

## 바뀌는 응답

없다. 지금은 `ZodError`를 던지는 경로가 없다.

## 검증

- `npm run check`: 통과. 백엔드 6개 중 5개 통과, 1개 건너뜀(`TEST_DATABASE_URL`을 비워 DB 통합 테스트 제외). 프론트엔드 57개 중 55개 통과, 2개 건너뜀. 스킬 테스트 4개 통과.
- DB 통합 테스트는 PR CI로 확인한다.
- 4.6.7에서의 동작은 아직 확인하지 못했다. 중앙 동기화 PR의 CI로 확인한다.
