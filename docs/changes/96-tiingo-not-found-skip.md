# #96 Tiingo에 없는 추적 종목의 반복 호출 줄이기

- 이슈: https://github.com/sirloinbh/money-ledger/issues/96
- 브랜치: `chore/96-tiingo-not-found-skip`

## 목적

Tiingo에 없는 미국 종목이 추적 종목이 되면 매일 받기가 30일 동안 매일 404 호출을 1회씩 썼다. 종가가 하나도 없는 종목은 상세를 열 때마다 즉시 받기로 Tiingo를 불렀다. 둘 다 공용 시간당 50회 한도를 헛되이 써서 매일 받기가 `rate_limited`로 밀릴 수 있다. #51(PR #95) 리뷰에서 나온 지적이다.

## 결정 (2026-11-10 사용자 확인, 이슈 댓글 기록)

1. Tiingo 404 종목은 마지막으로 부른 뒤 7일 동안 `fetchUsCloses` 안에서 건너뛴다. 매일 받기와 상세 즉시 받기 모두 해당한다. 호출 없이 "없는 종목"으로 답하고, 매일 받기에서 건너뛴 종목은 `price_fetch_failed` 로그를 남기지 않는다.
2. 종가가 없는 종목은 마지막 호출(`last_attempt_at`)이 1시간 안이면 상세에서 다시 부르지 않는다. 화면 문구는 직전 결과를 따른다. 빈 응답이었으면 문구가 없고, 오류였으면 "시세를 받지 못했습니다…"를 보여 준다. 매일 받기의 재시도에는 영향이 없다.

## 변경 내용

- `backend/src/prices/store.ts`: `getState`가 `last_error`도 돌려준다.
- `backend/src/prices/fetch.ts`: `fetchUsCloses`에 두 규칙을 더했다. 받을 날짜가 남아 있을 때만 확인하며, 둘 다 호출 한도를 쓰지 않는다.
  - `last_error`가 "Tiingo에 없는 종목입니다"이고 마지막 호출 뒤 7일이 안 됐으면 `known_missing`을 돌려준다. 매일 받기는 시작 시각이 날마다 몇 밀리초씩 다르므로, 7일째 실행이 간발의 차로 빠지지 않게 1시간 여유를 두었다(6일 23시간).
  - 선택 인자 `retryAfterMs` 안에 부른 적이 있으면 `tried_recently`(직전 응답이 비었음) 또는 `failed_recently`(직전이 오류)를 돌려준다. 매일 받기는 이 인자를 쓰지 않는다.
- `backend/src/prices/router.ts`: 상세의 즉시 받기는 `retryAfterMs`를 1시간으로 준다. `known_missing`은 `not_found`, `failed_recently`는 `fetch_failed` 문구로 보여 주고, 호출하지 않았으므로 `price_fetch_now` 로그는 남기지 않는다.
- `docs/price-source.md`: 두 규칙을 적었다.

DB 구조는 바뀌지 않는다(기존 `price_fetch_state` 열만 쓴다).

## 검증

- 테스트 DB: 전용 컨테이너 `money-ledger-test-agent3`(15493)
- `backend/test/prices.integration.test.ts`
  - 없는 종목: 첫날 한 번 부르고, 다음 6일은 매일 받기가 부르지 않으며 그 종목 로그도 없다. 그 사이 상세를 열면 호출 없이 `not_found`다. 7일째에 다시 한 번 부른다.
  - 종가 없는 종목: 빈 응답 종목과 오류 종목의 상세를 열면 한 번씩 부른다. 59분 뒤 다시 열면 호출 없이 직전 결과(문구 없음, `fetch_failed`)를 보여 주고, 1시간 뒤에는 다시 부른다.
