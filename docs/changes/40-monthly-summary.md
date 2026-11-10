# #40 월별 수입·지출 요약과 카테고리 비중 차트

- 이슈: https://github.com/sirloinbh/money-ledger/issues/40
- 브랜치: `feat/40-monthly-summary`

## 목적

한 달의 수입·지출·잔액과 카테고리별 지출 비중을 가계부 첫 부분에서 본다. 다른 시각화 이슈(#41, #48, #49, #54)가 함께 쓸 차트 도구도 정한다.

## 결정 (2026-11-08 사용자 확인, 이슈 댓글 기록)

- 차트 도구: Recharts. `recharts@3.10.1`(2026-07-25 배포, peer react 19 지원)을 버전 고정·`--ignore-scripts`로 설치했다. 에이전트의 `npm install`은 프로젝트 hook이 막아 사용자가 직접 실행했다.
- 카테고리 비중: 가로 막대.

## 구현에서 정한 것

- 비중은 지출만 본다. 미분류 지출은 "미분류" 한 줄이고, 숨긴 카테고리의 지출도 센다("(숨김)" 표시).
- 비중은 그 달 지출 대비 백분율, 소수 첫째 자리. SQL `numeric`의 `round`(0.5는 0에서 먼 쪽)로 계산해 문자열로 보낸다. 지출이 0원뿐인 달은 0.0%이다.
- 잔액은 수입 − 지출이다. 음수도 그대로 보인다.
- 요약의 달은 주소 `?month=YYYY-MM`이고 기본은 서울 기준 이번 달이다(이번 달이면 주소에서 뺀다). 내역 목록 필터와 따로 움직이고, 서로의 주소 값을 지우지 않는다.
- 차트 색: 공용 디자인 토큰에 차트 색이 없어 `frontend/src/index.css`에 `--chart-series-1`을 두었다. dataviz 기준 팔레트 1번(파랑) `#2a78d6`/다크 `#3987e5`이고, 카드 표면(흰색 / `#171717`)에 대해 검증기에서 밝기·채도·대비(3:1 이상)를 모두 통과했다. 한 계열이라 범례는 두지 않고 카드 제목이 이름이다.
- 차트는 막대 두께 24px 이하, 끝 4px 둥글림, 막대 끝에 비중(%) 표시, 마우스를 올리면 이름·금액·비중 툴팁. 축의 긴 이름은 8자에서 줄이고(…), 툴팁과 표에는 전체 이름이 나온다.
- 차트 값은 아래 표(카테고리·금액·비중, 합계)로도 본다. 화면 낭독기에는 차트를 이미지 하나("가장 큰 항목은 …, 모든 값은 아래 표에 있습니다")로 알리고 표를 읽게 한다.
- Recharts(약 382 kB)는 요약에서 차트를 그릴 때만 따로 불러온다(`React.lazy`). 앱 첫 번들에는 들어가지 않는다.

## 변경 내용

- `backend/src/summary.ts`, `backend/src/app.ts`: `GET /api/ledger/summary?month=YYYY-MM` → `{ month, income, expense, balance, categories: [{ categoryId, name, hidden, amount, share }] }`. 월 형식·범위(1900~2100) 검증은 한국어 400. 그 달은 1일부터 다음 달 1일 전까지다.
- `frontend/src/monthly-summary.tsx`: "월별 요약" 구역(이전 달·다음 달, 수입·지출·잔액, 카테고리별 지출 차트와 표, 불러오는 중·빈 달·실패와 다시 시도). 마지막 요청만 반영하고, 다른 달을 불러오는 동안 직전 값을 흐리게 남긴다.
- `frontend/src/category-share-chart.tsx`: 가로 막대 차트.
- `frontend/src/ledger.tsx`: 가계부 맨 위에 요약을 두고, 내역·카테고리가 바뀌면 다시 불러온다.
- `frontend/src/entry-filters-state.ts`, `frontend/src/entries.tsx`: 목록 필터가 주소를 쓸 때 다른 값(`month`)을 지우지 않는다.
- `frontend/src/index.css`: 차트 색 토큰.
- `frontend/package.json`, `package-lock.json`, `frontend/package-lock.json`(`npm run lockfiles:sync`): Recharts 추가.

## 테스트

- `backend/test/summary.test.ts`: 월 값 검증 6건(없음, 13월, 한 자리 월, 날짜, 두 번, 1899년)이 DB 전에 한국어 400.
- `backend/test/summary.integration.test.ts`: 실제 DB에서
  - 집계가 같은 달 내역을 직접 더한 값과 일치한다(전달 말일·다음 달 1일 제외, 양 끝 날짜 포함).
  - 카테고리 합이 지출과 같고, 순서·숨김·미분류가 맞다.
  - 비중 반올림(1/3 → 33.3, 2/3 → 66.7), 0원 지출만 있는 달(0.0), 빈 달, 음수 잔액.
- `frontend/src/monthly-summary.test.tsx`: 이번 달 기본 요청과 카드·표 값, 월 이동과 목록 필터 주소 유지, 새로고침·잘못된 월, 음수 잔액, 실패와 다시 시도, 버전 변경 시 다시 불러오기, 늦게 온 옛 달 응답 무시.
- `frontend/src/category-share-chart.test.tsx`: 차트 이미지 이름과 항목 수에 따른 높이. 막대 자체는 jsdom에 레이아웃이 없어 브라우저에서 확인했다.
- `frontend/src/entry-filters.test.tsx`: 필터를 적용해도 `month`가 남는다.

## 검증

- 테스트 DB: 전용 컨테이너 `money-ledger-test-agent2`(127.0.0.1:15492)를 다시 띄우고 010·012 마이그레이션을 적용했다.
- 이 셸의 `TEST_DATABASE_URL`이 다른 앱 DB(`study_test@localhost:5432`)를 가리키고 있었다(#32와 같음). 모르고 한 번 실행했는데, 그 DB가 꺼져 있어 연결이 모두 거부됐고 바뀐 것은 없다. 이후에는 매번 값을 직접 지정했다.
- `TEST_DATABASE_URL=<테스트 DB> npm run check`: 통과. 백엔드 262개 통과(건너뜀 0), 프론트엔드 225개 중 223개 통과·2개 건너뜀(기존), 스킬 4개, 빌드 성공.
  - 빌드의 "500 kB 넘는 묶음" 경고는 이번 변경 전부터 있던 것이다. 첫 번들(541 kB)에는 Recharts가 들어 있지 않다. Recharts를 빼고 나면 main에 있던 코드에 요약 코드 몇 kB만 더한 크기다. 차트는 별도 파일(382 kB)로 나뉜다.
- 브라우저: API(3192)를 테스트 DB에 연결하고 Vite(5292)를 띄워 headless Chrome(CDP)으로 `/ledger`를 확인했다. 11월 내역 43건(카테고리 9개, 긴 이름 "반려동물 용품과 병원비", 미분류 포함)과 10월 2건을 넣었다.
  - 390×844:
    - 11월은 수입 3,200,000원, 지출 1,373,200원, 잔액 1,826,800원이다. 막대 9개는 두께 23px 이하이고 차트 안에 들어간다. 첫 막대 끝에 16.1%, 표 첫 줄은 "의료 220,950원 16.1%", 합계는 1,373,200원이다.
    - 막대에 마우스를 올리면 "의료 220,950원 · 16.1%"가 보인다.
    - "이전 달" → `?month=2026-10`: 잔액 -900,000원, 막대 1개 100.0%. 9월은 "이 달에는 지출이 없습니다."
    - 다크 모드에서는 막대 색이 `#3987e5`로 바뀐다.
    - 가로 넘침 없음(scrollWidth 390).
  - 1440×900: 같은 결과다. 카드 세 개가 한 줄이고, 라이트·다크 모두 가로 넘침이 없다(scrollWidth = clientWidth).
