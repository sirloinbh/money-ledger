# 가계부·자산·모의투자 고유 지침

이 파일은 money-ledger에만 해당하는 규칙이다. 공통 지침은 [AGENTS.md](AGENTS.md)이며, 중앙 표준(`sirloinbh/project-standards`) 동기화 후에는 중앙 관리 파일이 된다. 두 파일이 다르면 이 파일이 우선한다.

## 작업 절차 (공통 절차에 더해)

- **PR을 올린 뒤 자동 코드 리뷰를 최대 2회 거치고, 최종 head의 필수 CI 검사가 모두 통과하면 에이전트(주 에이전트·로컬 워커)가 확인 없이 병합한다.** 리뷰에서 보완점이 나오면 추가 커밋으로 반영하고, 1차 보완 후에는 2차 리뷰를 한 번 더 받는다. 2차 보완 커밋 뒤에는 더 리뷰하지 않는다. 보완점이 없으면 바로 다음 단계로 간다. 이 PR에서 고치기에 큰 수정은 새 이슈카드로 분리한다. 상세 절차는 implementation 스킬을 따른다. 병합은 프로젝트 래퍼로 `pr merge <url> --merge --match-head-commit <검증한 head SHA>`(merge commit)를 실행하고 연결 이슈(`Closes #N`)가 닫혔는지 확인한다. 연속 PR은 순서대로 병합한다. 앞 PR 병합 후 다음 PR 브랜치에 `origin/main`을 병합해 충돌을 풀고, 관련 테스트를 다시 실행하고, 일반 푸시 후 CI 통과를 기다려 병합한다. 실패·실행 중 검사가 있는 PR 병합, `--admin` 등 브랜치 보호 우회, 자기 PR 승인으로 검토 대체, `main` 직접 커밋·푸시, 강제 푸시는 하지 않는다. 현재 `main` 병합은 배포를 일으키지 않는다(배포 미연결).

## 고유 스킬

- [money-ledger-implementation](skills/money-ledger-implementation/SKILL.md), [money-ledger-testing](skills/money-ledger-testing/SKILL.md), [money-ledger-foundation](skills/money-ledger-foundation/SKILL.md): 이 프로젝트의 리뷰·병합 절차가 들어 있어 공통 스킬(std-*)이 들어온 뒤에도 유지한다.

## 서비스 규칙

### 수량·외화·환율 (2026-11-03 사용자 결정, #35)

중앙 `docs/conventions/domain.md`의 금액 규칙(원 단위 정수, `bigint`)에 더해, 주식 수량과 외화를 이렇게 다룬다. 중앙 문서 반영은 [project-standards#401](https://github.com/sirloinbh/project-standards/issues/401)에서 한다.

| 값             | 저장(PostgreSQL)                             | API 값                     | 범위                      |
| -------------- | -------------------------------------------- | -------------------------- | ------------------------- |
| 통화 코드      | `text`, `CHECK (currency IN ('KRW', 'USD'))` | `'KRW' \| 'USD'`           | 처음에는 두 통화만 다룬다 |
| 수량           | `numeric(20,8)`                              | 소수 문자열 `"0.12345678"` | `CHECK (quantity > 0)`    |
| 원화 금액      | `bigint` (원)                                | 정수 숫자                  | 중앙 금액 규칙 그대로     |
| 외화 금액·단가 | `numeric(20,4)` + 같은 행의 `currency`       | 소수 문자열 `"123.4500"`   | 0 이상                    |
| 환율           | `numeric(12,4)`, 외화 1단위당 원             | 소수 문자열 `"1385.2500"`  | `CHECK (fx_rate > 0)`     |

- 단가·거래 금액처럼 통화에 따라 달라지는 값은 한 컬럼(`numeric(20,4)`)과 `currency`로 저장한다. `currency = 'KRW'`이면 소수점 아래가 0이어야 한다(`CHECK (currency <> 'KRW' OR amount = trunc(amount))`).
- `numeric` 값은 API에서 문자열로 주고받는다. JavaScript `number`(부동소수)로 바꿔 계산하지 않는다. 곱셈·합계는 SQL `numeric` 연산이나 정수 연산으로 한다. 입력 검증은 Zod 정규식으로 자릿수(정수부·소수부)를 확인한다.
- KRW에는 환율을 저장하지 않는다(항상 1). 외화 거래 행에는 그 거래일의 환율(`fx_rate`)과 원화 환산액(`amount_krw bigint`)을 함께 저장한다. 나중에 환율이 바뀌어도 거래 기록의 원화 금액은 바뀌지 않는다.
- 평가(현재 가치)는 조회 시점의 최신 환율로 원화 환산한다. 환율 출처와 갱신 주기는 #36에서 정한다.
- 원화 환산은 계산의 마지막에 한 번만 한다: `round(수량 × 단가 × 환율)`. 원 단위에서 반올림하며 0.5는 올린다(PostgreSQL `round(numeric)`과 같다). 중간 결과를 원 단위로 미리 반올림하지 않는다.
- 합계는 원화 환산액끼리 더한다. 통화가 다른 외화 금액을 그대로 더하지 않는다.
