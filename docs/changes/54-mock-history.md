# #54 모의투자 거래 내역과 수익률 추이 차트

- 이슈: https://github.com/sirloinbh/money-ledger/issues/54
- 브랜치: `feat/54-mock-history`

## 목적

모의투자 계좌의 지난 거래를 기간·종목으로 찾고, 계좌 수익률이 날짜별로 어떻게 변했는지 차트로 본다.

## 결정 (2026-11-10 사용자 확인, 이슈 댓글 기록)

1. 스냅샷은 매일 시세 받기가 끝날 때와 주문이 체결될 때 (계좌, KST 날짜) 한 건으로 저장한다. 같은 날짜는 덮어쓴다.
2. 값은 #53과 같은 계산(현금 + 저장된 최신 종가·환율 평가금액)이다. 시세가 나중에 바뀌어도 저장된 값은 고치지 않는다.
3. 과거는 다시 계산하지 않는다. 차트는 계좌 시작일 0%에서 출발해 저장된 스냅샷만 잇는다.
4. 열린 계좌만 보여 준다. 닫힌 계좌의 기록은 지우지 않는다.
5. 거래 내역은 기간(KST 주문일)·종목으로 거르고 최신순 50건씩 "더 보기"로 보여 준다. 차트는 수익률 꺾은선 하나이고 기간은 1개월·3개월·전체다.

## 변경 내용

- `database/migrations/018_mock_snapshots.sql`: `mock_snapshots`(계좌, 날짜) 기본키, 현금·평가금액·총자산·손익·수익률. `total_krw = cash_krw + value_krw` CHECK. 다시 실행해도 안전하다.
- `backend/src/mock-orders.ts`: `GET /api/mock/accounts/:id/orders?from&to&securityId&before`
  - 날짜는 주문 시각을 서울 시간으로 바꾼 날이다.
  - 최신순 50건, `before`는 이미 본 마지막 주문 ID다. `hasMore`로 다음 쪽이 있는지 알린다.
  - 필터용으로 이 계좌가 거래한 종목 목록(`securities`)을 함께 돌려준다.
  - 잘못된 날짜, 시작일 > 종료일, 잘못된 종목·위치는 한국어 400이다.
  - 주문이 체결되면 같은 트랜잭션에서 그날 스냅샷을 저장한다.
- `backend/src/mock-holdings.ts`: 평가 계산을 `accountValue()`로 꺼내 보유 화면과 스냅샷이 같은 식을 쓴다.
- `backend/src/mock-snapshots.ts`
  - `saveSnapshot()`: 시세나 환율이 없는 보유 종목이 있으면 틀린 값을 남기지 않고 건너뛴다.
  - `snapshotOpenAccount()`: 하루치 시세 받기 뒤 열린 계좌의 그날 값을 저장한다.
  - `GET /api/mock/accounts/:id/snapshots`: 계좌 시작일(KST), 시작 금액, 날짜순 스냅샷.
- `backend/src/prices/scheduler.ts`, `server.ts`: 하루치 시세 받기가 한 번 돌 때마다 `afterFetch`를 부른다. 여기서 난 오류는 `price_after_fetch_error`로 따로 남기고, 시세 받기 실패로 치지 않는다.
- `frontend/src/mock-returns.tsx`, `mock-return-chart.tsx`: "수익률 추이" 카드
  - 기간 1개월(기본)·3개월·전체
  - 시작일 0%를 첫 점으로 넣는다. 시작일에 저장된 값이 있으면 그 값을 쓴다.
  - #40 패턴: 차트 파일은 lazy로 따로 불러오고, 실패하면 "다시 시도"와 표가 남는다. 색은 `--chart-series-1`, 차트는 화면 낭독기에 이미지 하나이고 값은 "표로 보기"에 모두 있다.
- `frontend/src/mock-history.tsx`: "거래 내역" 카드(시작일·종료일·종목 필터, 필터 지우기, 더 보기)
- `frontend/src/mock-account.tsx`: 열린 계좌가 있을 때 두 카드를 계좌 카드 아래에 보여 준다. 계좌 ID로 다시 그려 초기화 뒤 이전 계좌 값이 남지 않는다.
- `frontend/src/format.ts`: 부호 있는 퍼센트 `signedPercent()`를 보유 화면과 함께 쓴다.

## 검증

- 테스트 DB: 전용 컨테이너 `money-ledger-test-agent3`(15493)
- `backend/test/mock-orders.integration.test.ts`
  - 거래 내역: 서울 날짜 경계(00:30, 23:59)의 기간 필터, 종목 필터, 51건 추가 뒤 50건과 다음 쪽, 잘못된 값 400, 없는 계좌 404
  - 스냅샷: 같은 날 주문 두 번 → 한 건(마지막 값), 다음 날 하루치 받기 → 새 날짜(+0.94%), 닫힌 계좌는 저장 안 함, 나중 시세 변경에도 저장 값 그대로, 같은 날 다시 저장하면 덮어씀(+1.94%, 행 2개), 환율 없으면 저장 안 함, 계좌 시작일은 서울 날짜, 없는 계좌 404
- `backend/test/prices.integration.test.ts`: 하루치 받기가 돈 뒤 `afterFetch`를 부르고, 그 실패는 따로 기록되며 그날 받기는 끝난 것으로 남는다.
- 화면 테스트
  - `mock-returns.test.tsx`: 기간별 점, 시작일 0%, 표, 점이 하나뿐일 때와 기간 안에 값이 없을 때 안내, 불러오기 실패
  - `mock-returns-chart-error.test.tsx`: 차트 파일 실패 → 표 유지 → 다시 시도
  - `mock-return-chart.test.tsx`: 차트 이미지 이름
  - `mock-history.test.tsx`: 표시, 기간·종목 필터 주소, 필터 지우기, 시작일 > 종료일 거부, 더 보기, 거래 없음, 다시 불러오기
  - `format.test.ts`: `signedPercent`
- 브라우저: API(3193, 테스트 DB, 가짜 출처)와 Vite(5293)를 띄워 headless Chrome으로 390×844와 1440×900에서 확인했다. 크기마다 1,000만 원 새 계좌로 시작했고, 계좌 시작일을 10월 20일로 바꾸고 10월 25일(−0.5%)·11월 1일(+1.2%) 스냅샷을 테스트 데이터로 넣었다.
  - 주문 전 거래 내역: "아직 거래가 없습니다."
  - 삼성전자 10주 매수, Apple 2주 매수, Apple 1주 매도 뒤 거래 내역 3건(최신순), 종목 목록 "Apple Inc (AAPL)", "삼성전자 (005930)"
  - 종목을 Apple로 거르면 Apple 2건만 남는다.
  - 수익률 추이(전체): 10월 20일 0%, 10월 25일 −0.5%, 11월 1일 +1.2%, 11월 10일(주문 때 저장) 0%(−1원) 네 점이 한 선으로 이어지고, 표도 같은 값이다.
  - 가로 넘침 없음. 390 폭에서 표의 날짜가 두 줄로 꺾여 한 줄로 고쳤다.
- `TEST_DATABASE_URL=<전용 테스트 DB> npm run check` 통과(origin/main 병합 뒤): 백엔드 300개 통과·건너뜀 0, 프론트엔드 264개 통과·2개 건너뜀(기존), 스킬 4개, 빌드 성공. `npm run knip` 통과.

## 제한·후속

- 닫힌 계좌의 거래 내역과 수익률 추이를 보는 화면은 없다(결정 4). 기록은 남아 있다.
- 서버가 하루 종일 꺼져 있으면 그날 스냅샷이 없고, 차트는 앞뒤 저장된 날을 바로 잇는다.
- 실제 시세 키로는 확인하지 않았다(#85).
