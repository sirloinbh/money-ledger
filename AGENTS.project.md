# 가계부·자산·모의투자 고유 지침

이 파일은 money-ledger에만 해당하는 규칙이다. 공통 지침은 [AGENTS.md](AGENTS.md)이며, 중앙 표준(`sirloinbh/project-standards`) 동기화 후에는 중앙 관리 파일이 된다. 두 파일이 다르면 이 파일이 우선한다.

## 작업 절차 (공통 절차에 더해)

- **PR을 올린 뒤 자동 코드 리뷰를 최대 2회 거치고, 최종 head의 필수 CI 검사가 모두 통과하면 에이전트(주 에이전트·로컬 워커)가 확인 없이 병합한다.** 리뷰에서 보완점이 나오면 추가 커밋으로 반영하고, 1차 보완 후에는 2차 리뷰를 한 번 더 받는다. 2차 보완 커밋 뒤에는 더 리뷰하지 않는다. 보완점이 없으면 바로 다음 단계로 간다. 이 PR에서 고치기에 큰 수정은 새 이슈카드로 분리한다. 상세 절차는 implementation 스킬을 따른다. 병합은 프로젝트 래퍼로 `pr merge <url> --merge --match-head-commit <검증한 head SHA>`(merge commit)를 실행하고 연결 이슈(`Closes #N`)가 닫혔는지 확인한다. 연속 PR은 순서대로 병합한다. 앞 PR 병합 후 다음 PR 브랜치에 `origin/main`을 병합해 충돌을 풀고, 관련 테스트를 다시 실행하고, 일반 푸시 후 CI 통과를 기다려 병합한다. 실패·실행 중 검사가 있는 PR 병합, `--admin` 등 브랜치 보호 우회, 자기 PR 승인으로 검토 대체, `main` 직접 커밋·푸시, 강제 푸시는 하지 않는다. 현재 `main` 병합은 배포를 일으키지 않는다(배포 미연결).

## 고유 스킬

- [money-ledger-implementation](skills/money-ledger-implementation/SKILL.md), [money-ledger-testing](skills/money-ledger-testing/SKILL.md), [money-ledger-foundation](skills/money-ledger-foundation/SKILL.md): 이 프로젝트의 리뷰·병합 절차가 들어 있어 공통 스킬(std-*)이 들어온 뒤에도 유지한다.

## 서비스 규칙

### 수량·외화·환율 (2026-11-03 사용자 결정, #35)

중앙 `docs/conventions/domain.md`의 금액 규칙(원 단위 정수, `bigint`)에 더해, 주식 수량과 외화를 이렇게 다룬다. 중앙 문서 반영은 [project-standards#401](https://github.com/sirloinbh/project-standards/issues/401)에서 한다.

| 값        | 저장(PostgreSQL)                             | API 값                     | 범위                                        |
| --------- | -------------------------------------------- | -------------------------- | ------------------------------------------- |
| 통화 코드 | `text`, `CHECK (currency IN ('KRW', 'USD'))` | `'KRW' \| 'USD'`           | 처음에는 두 통화만 다룬다                   |
| 수량      | `numeric(20,8)`                              | 소수 문자열 `"0.12345678"` | `CHECK (quantity > 0)`                      |
| 원화 금액 | `bigint` (원)                                | 정수 숫자                  | 중앙 금액 규칙 그대로                       |
| 단가      | `numeric(20,4)` + 같은 행의 `currency`       | 소수 문자열 `"123.4500"`   | `CHECK (price > 0)`                         |
| 외화 금액 | `numeric(20,4)` + 같은 행의 `currency`       | 소수 문자열 `"123.4500"`   | `CHECK (currency <> 'KRW' AND amount >= 0)` |
| 환율      | `numeric(12,4)`, 외화 1단위당 원             | 소수 문자열 `"1385.2500"`  | `CHECK (fx_rate > 0)`                       |

- 단가는 통화와 관계없이 한 컬럼(`numeric(20,4)`)과 `currency`로 저장하고 API에서도 소수 문자열이다. `currency = 'KRW'`인 단가는 소수점 아래가 0이어야 한다(`CHECK (currency <> 'KRW' OR price = trunc(price))`).
- 원화 금액은 언제나 `bigint`다. `numeric(20,4)` 금액 컬럼(외화 예금 잔액 등)은 USD 전용이며 KRW 금액을 담지 않는다. 원화·외화가 모두 올 수 있는 금액은 `amount_krw bigint`와 `amount_foreign numeric(20,4)` 두 컬럼으로 나눈다.
- `numeric` 값은 API에서 문자열로 주고받는다. JavaScript `number`(부동소수)로 바꿔 계산하지 않는다. 곱셈·합계·반올림은 SQL `numeric` 연산으로 한다. 입력 검증은 Zod 정규식으로 자릿수(정수부·소수부)를 확인한다.
- 거래 행은 수량, 단가, `currency`, 환율(`fx_rate`), 원화 거래액(`amount_krw bigint NOT NULL`)을 저장한다. 환율은 KRW이면 `NULL`, USD이면 거래일 환율을 반드시 넣는다(`CHECK ((currency = 'KRW') = (fx_rate IS NULL))`). 나중에 환율이 바뀌어도 거래 기록의 원화 금액은 바뀌지 않는다.
- 원화 거래액은 저장할 때 한 번 계산한다: `amount_krw = round(수량 × 단가 × coalesce(fx_rate, 1))`. 외화 총액 같은 중간 결과를 먼저 반올림하지 않는다.
- 외화 거래 총액은 저장하지 않고 필요할 때 `수량 × 단가`로 계산한다. 화면에 보일 값은 SQL에서 `round(수량 × 단가, 2)`(센트)로 만들어 보낸다. 화면에서 `Number(...).toFixed()`로 반올림하지 않는다.
- 평가(현재 가치)는 조회 시점의 최신 환율로 원화 환산한다: `round(수량 × 현재가 × 최신 환율)`. 시세·환율 출처와 갱신 주기는 [docs/price-source.md](docs/price-source.md)(#36)를 따른다: 하루 한 번 받은 종가와 한국수출입은행 매매기준율을 쓴다. 모의 주문의 거래일 환율은 주문 시점에 저장된 최신 매매기준율이다.
- 반올림은 PostgreSQL `round(numeric)`을 쓰며, 0.5는 0에서 먼 쪽으로 보낸다(`round(2.5) = 3`, `round(-2.5) = -3`). 피연산자는 모두 `numeric`이어야 한다. `double precision`이 섞이면 짝수 반올림으로 바뀐다. 음수 -2.5를 -2로 만드는 JS `Math.round`로 대신하지 않는다.
- 합계는 원화 환산액끼리 더한다. 통화가 다른 외화 금액을 그대로 더하지 않는다.
