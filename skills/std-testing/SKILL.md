---
name: std-testing
description: Write or update behavior-focused tests with implementations and fixes in a sirloinbh app repository, run them before commits and PR creation or updates, and record actual results. Use with std-implementation; for documentation-only changes validate the changed artifacts instead of adding unrelated app tests.
---

<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/skills/std-testing/에서 -->

# 가계부·자산 포트폴리오 테스트 작성과 실행

프로젝트의 `AGENTS.md`, `AGENTS.project.md`와 [std-implementation](../std-implementation/SKILL.md) 절차를 함께 따른다. 이 스킬은 테스트 작성·실행 기준이며, 이슈·브랜치·docs·PR 절차와 병합 정책을 바꾸지 않는다. 프로젝트에 설치된 테스트 도구와 위치는 `AGENTS.project.md`에 있다.

## 구현·수정과 함께 작성

- 기능을 구현하거나 동작을 바꿀 때 그 요구사항을 검증하는 테스트를 함께 추가·수정하고, 구현과 테스트를 같은 커밋에 포함한다. 기존 테스트 실행만으로 새 기능 검증을 대신하지 않는다.
- 버그 수정에는 그 버그의 재발을 잡는 회귀 테스트를 추가한다. 가능하면 수정 전 실패·수정 후 성공을 확인하고, 재현하지 못하면 그 한계를 기록한다.
- 리팩터링은 기존 동작 보존을 검증한다. 부족한 시나리오는 보강한다.
- 내부 구현을 그대로 반복하는 테스트보다 사용자에게 보이는 결과와 도메인 규칙을 검증한다. 정상 경로와, 변경에 관련된 입력 오류·경계·실패 경로를 고른다.
- 업무 로직은 단위, API·DB 저장·트랜잭션은 통합, 화면 입력·저장 흐름은 컴포넌트 또는 브라우저 테스트를 고른다. 모든 변경에 모든 종류를 추가하지 않는다.
- 현재 설치된 테스트 도구와 명령을 확인한다. 아직 도입하지 않은 도구(Vitest, Playwright 등)를 쓴 것처럼 보고하지 않는다.
- 테스트 데이터는 운영·사용자 데이터와 분리한다. 테스트 DB는 `money_test`처럼 전용 DB를 쓴다. 시간·날짜·무작위 값에 의존하는 검사는 실행 환경이 바뀌어도 같은 의미를 검증하도록 쓴다.

## 커밋 전

- 최종 커밋 대상의 변경과 테스트를 확인하고 관련 테스트를 실제로 실행한다. 구현·테스트·docs 기록을 같은 커밋에 넣는다.
- 테스트 코드 경로, 검증한 동작, 실행 명령과 결과를 `docs/changes`의 해당 이슈 기록에 남긴다.
- 실패한 테스트를 skip·삭제하거나 assertion을 약하게 바꿔 통과시키지 않는다. 실패를 해결한 뒤 커밋한다.
- 필요한 실행 환경을 준비할 수 없다면 실행하지 않았다고 기록한다. 검증되지 않은 구현을 완료로 보고하지 않고, 남은 검증이 있는 PR은 draft로 전달한다.

## PR 생성·갱신 전

- 최종 diff에 대해 관련 테스트와 프로젝트 필수 검사를 실행하고 성공을 확인한다. 커밋 후 변경이 없고 같은 대상의 결과가 유효하면 같은 검사를 반복하지 않는다.
- PR에 추가·수정한 테스트, 실행 명령, pass/fail/skip, 실행하지 않은 이유를 적는다. DB 환경변수가 없어 건너뛴 통합 테스트는 성공으로 세지 않는다.
- PR 이후 코드·테스트를 고치면 영향받는 검사를 다시 실행하고 docs·PR 결과를 갱신한다. CI 실패도 해결한다.
- 문서·스킬·포맷만 바뀌고 앱 동작 변경이 없으면, 그 산출물의 검증기·포맷·링크 검사로 검증하고 앱 테스트를 추가하지 않은 이유를 적는다.
