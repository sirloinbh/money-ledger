---
name: money-ledger-foundation
description: Establish or improve the repeatable development foundation of the money-ledger app, covering stack, structure, conventions, API contracts, design, tests, AI guidance, and deployment. Use for project foundation requests; apply only the requested scope through the money-ledger-implementation issue-to-PR workflow.
---

# 가계부·자산 포트폴리오 개발 기반

이 앱의 개발·검증·운영 방식을 반복 가능하게 정리한다. 먼저 프로젝트 루트의 `AGENTS.md`와 `skills/money-ledger-implementation/SKILL.md`를 읽고, 이슈 → 번호 기반 브랜치 → 구현 및 docs 기록 → 테스트·PR → CI 통과 후 병합 절차로 진행한다. 이 스킬이 이슈·PR 절차를 생략하거나 배포 권한을 부여하지 않는다.

## 기준

- 기준 문서는 `docs/project-setup.md`이다. 현재 package.json, 잠금 파일, API·SQL, Compose, CI를 확인해 실제 구현과 추천(미도입)을 구분한다. 추천 목록 전체를 자동 설치하지 않는다.
- 사용자는 본인 한 명이며 로그인은 현재 요구사항에 없다. 날짜는 Asia/Seoul 기준이다.
- 도구를 바꾸거나 추가할 때는 실제 문제·데이터 영향·검증 방법을 먼저 정리하고, 패키지 설치는 사용자 재확인 후에만 한다.

## 수행

1. 현재 상태와 이슈의 완료 기준을 정하고, 선택 이유·구조·계약을 문서에 기록한다.
2. 도구 설정, 실행 명령, CI와 문서를 같은 변경에서 맞춘다. 사용하지 않는 설정·스크립트·빈 모듈은 만들지 않는다.
3. API·DB 변경은 기존 데이터와 날짜·단위 의미를 보존하고, 마이그레이션 적용과 실패 복구 방법을 검증한다. DB 마이그레이션 원본은 하나로 정한다.
4. 화면 변경은 디자인 토큰(`frontend/src/style.css`의 CSS 변수)과 기존 컴포넌트를 유지하면서 로딩·빈 결과·오류·키보드 접근을 해당 범위에서 정리한다.
5. `skills/money-ledger-testing/SKILL.md`를 함께 적용한다. 구현과 테스트를 함께 작성하고, 버그에는 회귀 테스트를 추가하며, 실제 결과를 docs·PR에 기록한다.
6. 배포는 사용자 요청 범위에서만 한다. 이미지 버전, health check, 비밀값 관리, 백업·복원, 이전 버전 복구를 준비한다.
7. 각 작업 커밋에 docs 기록을 포함하고 검증한 PR을 만들고, 필수 CI가 통과하면 money-ledger-implementation 절차대로 병합한다.

## 완료 기준

새 환경에서 문서대로 설치·실행·검증을 재현할 수 있고, 선택한 도구가 실제 코드·명령·CI에 반영되어야 한다. 미설치 도구, 건너뛴 검사, 실제로 하지 않은 배포는 후속 작업으로 명시한다.
