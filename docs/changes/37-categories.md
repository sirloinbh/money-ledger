# #37 수입·지출 카테고리 관리

- 이슈: [#37](https://github.com/sirloinbh/money-ledger/issues/37)
- 브랜치: `feat/37-categories`

## 목적

내역을 분류할 카테고리를 만든다. 이후 내역 기록(#38), 집계, 예산, 과소비 점검이 이 데이터를 쓴다.

## 정한 규칙

- 기본 카테고리: 지출(식비, 교통, 주거, 통신, 생활, 의료, 여가, 기타), 수입(급여, 부수입, 기타). 사용자가 추천안을 바꾸지 않고 시작을 요청해 그대로 적용했다.
- 카테고리는 지우지 않고 숨긴다. 그래서 삭제 API가 없다.
- 이름은 앞뒤 공백을 지우고 1~30자이며, 같은 종류 안에서 겹칠 수 없다. 수입과 지출에는 같은 이름을 쓸 수 있다.
- 만든 뒤에는 종류를 바꿀 수 없다. 이미 기록한 내역의 의미가 달라지기 때문이다.

## 변경 — 2026-11-02

- `database/migrations/002_categories.sql`: `categories` 테이블과 기본 카테고리. 기본 카테고리는 테이블이 비어 있을 때만 넣어, 다시 실행해도 사용자가 바꾼 이름이 되돌아오지 않는다.
- `backend/src/routes/categories.ts`: API 3개.
  - `GET /api/categories`: 숨긴 항목을 뺀 목록. 새 내역 입력에 쓴다. `?includeHidden=true`면 모두 준다.
  - `POST /api/categories`: 추가.
  - `PATCH /api/categories/:id`: 이름 변경과 숨김 처리.
- `backend/src/app.ts`: 오류 처리를 중앙 `standard/http.ts`의 `errorHandler`, `notFound`로 바꿨다. 요청 본문을 받는 첫 API라서, 깨진 JSON이 500이 아니라 400이 되어야 한다.
- `frontend/src/categories.tsx`: 카테고리 관리 화면(`/ledger/categories`). 가계부 화면에서 연결했다.
- `frontend/src/page.tsx`, `ledger.tsx`, `app.tsx`: 빈 상태 화면의 행동 버튼과 새 주소를 추가했다.

## 브라우저 확인에서 찾아 고친 문제

- 요청 중 버튼을 `disabled`로 두면 키보드 포커스가 페이지 맨 앞으로 사라졌다. `aria-disabled`와 중복 요청 차단으로 바꿨다. 회귀 테스트는 옛 코드에서 실패하는 것을 확인했다.
- 알림이 페이지 맨 위에만 나와, 모바일에서 긴 목록 아래의 입력칸을 쓰면 중복 이름 오류가 화면 밖에 표시됐다. 저장 결과를 토스트로 바꿨다. 불러오기 실패는 그대로 화면 안 경고로 보여 준다.

## 검증

- `backend/test/categories.test.ts`: 가짜 풀로 입력 검증, 30자 경계, 404, 409, 깨진 JSON, 500 응답을 확인한다.
- `backend/test/categories.integration.test.ts`: 실제 DB에서 기본 카테고리와 한글, 종류별 이름 중복, 숨김과 복원, 마이그레이션 재실행을 확인한다.
- `frontend/src/categories.test.tsx`: 목록, 추가, 중복 오류, 이름 변경과 포커스, Escape 취소, 숨김, 요청 중 상태, 불러오기 실패와 재시도를 확인한다.
- `npm run check`: 통과. 백엔드 23개 중 21개 통과, 2개 건너뜀. 프론트엔드 78개 중 76개 통과, 2개 건너뜀. 스킬 테스트 4개 통과.
- 건너뛴 백엔드 2개는 DB 통합 테스트다. 이 PC의 `TEST_DATABASE_URL`이 다른 앱의 DB를 가리켜([#32](32-dev-env-followups.md)) 비우고 실행했다. PR CI의 PostgreSQL로 확인한다.
- `npm run standards:check`, `npm run knip`: 통과.
- 브라우저: headless Chrome으로 모바일 390×844와 PC 1440×900을 확인했다. 가계부 화면에서 이동, 추가, 중복 거부, 30자 이름, 이름 변경, 숨김, 다시 표시를 실제 클릭과 입력으로 진행했다. 가로 스크롤이 없고, 토스트는 화면 안에 보이며, 포커스가 누른 버튼에 남는다.

## 한계

- 브라우저 확인은 `/api` 응답을 가짜로 넣어 진행했다. Docker와 `.env`를 미뤄서([#32](32-dev-env-followups.md)) 이 PC에 전용 DB가 없다. API와 DB의 연결은 CI 통합 테스트로 확인하지만, 실제 DB까지 이은 화면 확인은 복구 후에 해야 한다.
- 숨긴 카테고리가 입력 목록에 안 나오는 것은 API 기준으로 확인했다. 입력 화면은 #38에서 만든다.
- 이 앱에는 마이그레이션 실행기(`db:migrate`)가 아직 없다. CI가 psql로 두 번 적용하며 경고를 남긴다.
