---
name: std-foundation
description: Establish or improve the repeatable development foundation of a sirloinbh app, covering stack, structure, conventions, API contracts, design, tests, AI guidance, and deployment. Use for project foundation requests; apply only the requested scope through the std-implementation issue-to-PR workflow.
---

<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/skills/std-foundation/에서 -->

# 가계부·자산 포트폴리오 개발 기반

이 앱의 개발·검증·운영 방식을 반복할 수 있게 정리한다. 먼저 프로젝트 루트의 `AGENTS.md`, `AGENTS.project.md`와 [std-implementation](../std-implementation/SKILL.md)을 읽고, 이슈 → 번호 기반 브랜치 → 구현과 docs 기록 → 테스트·PR 절차로 진행한다. 이 스킬은 이슈·PR 절차를 생략하거나 배포·병합 권한을 주지 않는다.

## 기준

- 공통 기준(스택 허용 목록, 버전, 디렉토리 규칙, 디자인 토큰)은 중앙 리포 `sirloinbh/project-standards`가 정한다. 공통 기준을 바꿔야 하면 이 리포가 아니라 중앙 리포에 이슈를 연다.
- 현재 package.json, 잠금 파일, API·SQL, Compose, CI를 확인해 실제 구현과 추천(미도입)을 구분한다. 추천 목록 전체를 자동 설치하지 않는다.
- 사용자는 본인 한 명이며 로그인은 현재 요구사항에 없다. 날짜는 Asia/Seoul 기준이다. 프로젝트 고유의 도메인 규칙은 `AGENTS.project.md`에 있다.
- 도구를 바꾸거나 추가할 때는 실제 문제·데이터 영향·검증 방법을 먼저 정리하고, 패키지 설치는 사용자 재확인 후에만 한다.

## 수행

1. 현재 상태와 이슈의 완료 기준을 정하고, 선택 이유·구조·계약을 문서에 기록한다.
2. 도구 설정, 실행 명령, CI와 문서를 같은 변경에서 맞춘다. 쓰지 않는 설정·스크립트·빈 모듈은 만들지 않는다.
3. API·DB 변경은 기존 데이터와 날짜·단위 의미를 보존하고, 마이그레이션 적용과 실패 복구 방법을 검증한다. DB 마이그레이션 원본은 하나로 정한다.
4. 화면 변경은 공통 디자인 토큰과 공통 컴포넌트를 쓰고, 로딩·빈 결과·오류·키보드 접근을 해당 범위에서 정리한다.
5. [std-testing](../std-testing/SKILL.md)을 함께 적용한다. 구현과 테스트를 함께 작성하고, 버그에는 회귀 테스트를 추가하며, 실제 결과를 docs·PR에 기록한다.
6. 배포는 사용자 요청 범위에서만 한다. 이미지 버전, health check, 비밀값 관리, 백업·복원, 이전 버전 복구를 준비한다. 비용이 드는 리소스는 목적과 예산에 맞게 고른다.
7. 각 작업 커밋에 docs 기록을 포함하고 검증한 PR을 만든다. 병합은 `AGENTS.md`의 규칙을 따른다.

## 완료 기준

새 환경에서 문서대로 설치·실행·검증을 재현할 수 있고, 고른 도구가 실제 코드·명령·CI에 반영되어 있어야 한다. 설치하지 않은 도구, 건너뛴 검사, 실제로 하지 않은 배포는 후속 작업으로 적는다.
