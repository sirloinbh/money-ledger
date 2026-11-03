# #70 API 요청 횟수 제한

- 이슈: [#70](https://github.com/sirloinbh/money-ledger/issues/70)
- 브랜치: `chore/70-api-rate-limit`

## 목적

CodeQL `js/missing-rate-limiting`(high)이 DB를 부르는 라우트마다 나와 #37 PR(#69)을 막았다. CodeQL은 Express 미들웨어만 인식하므로 nginx 제한과 별도로 API 서버에도 제한을 둔다. 중앙 기준 project-standards#291과 life-journal의 방식을 따른다.

## 변경 — 2026-11-03

- 사용자가 `npm install express-rate-limit@8.7.1 --save-exact --ignore-scripts -w backend`로 설치했다(프로젝트 훅이 에이전트 설치를 막는다). npm이 `backend/package.json`의 `devDependencies` 순서를 이름순으로 바꿨다.
- `npm run lockfiles:sync`로 하위 저장소용 `backend/package-lock.json`을 루트 lockfile에 맞췄다.
- `backend/src/app.ts`: `/api` 전체에 IP별 분당 600회 제한을 달았다(nginx의 초당 10회와 같은 수준). 넘으면 429와 `요청이 너무 많습니다. 잠시 후 다시 시도해 주세요`를 보낸다. 응답 헤더는 `RateLimit`(draft-8) 형식이다. 테스트가 한도를 바꿀 수 있게 `createApp`에 `requestsPerMinute` 옵션을 두었다.
- `backend/test/helpers.ts`: `withApi`가 `createApp`의 옵션을 그대로 받는다.

## 검증

- `backend/test/rate-limit.test.ts`(2개): 한도 2회에서 세 번째 요청이 한국어 429를 받는다. 기본 한도에서는 50회 연속 요청이 모두 200이다.
- `TEST_DATABASE_URL=<테스트 DB> npm run check`: 통과. 백엔드 8개 통과·건너뜀 0, 프론트엔드 67개 중 65개 통과·2개 건너뜀(기존), 스킬 4개 통과.
- `npm run standards:check`: 통과.

## 한계

- 운영에서는 nginx를 거치므로 API가 보는 IP가 프론트엔드 컨테이너 하나다. 사용자가 한 명인 앱이라 전체 한도로 동작해도 문제없고, 클라이언트별 제한은 nginx가 맡는다. 다른 앱과 같은 판단이다.
