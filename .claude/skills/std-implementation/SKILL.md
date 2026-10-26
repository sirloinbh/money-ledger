---
name: std-implementation
description: Follow the issue, numbered branch, implementation with docs, tests, and PR workflow for changes to a sirloinbh project repository. Use for code, configuration, documentation, and skill edits; exclude read-only questions and recommendations. Merge only as the repository's AGENTS.md allows.
---

<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/common/skills/std-implementation/에서 -->

# 구현 절차

이 스킬은 `sirloinbh/money-ledger` 리포의 변경 작업에 적용한다. 프로젝트 루트의 `AGENTS.md`(있으면 `AGENTS.project.md`도)와 관련 문서를 먼저 읽는다. 아래 순서를 지키고, 검증한 PR을 결과로 제공한다.

함께 쓰는 스킬:

- [std-backlog](../std-backlog/SKILL.md): 이슈 세분화, 우선순위·특성 라벨, 다음 작업 선택
- [std-git-writing](../std-git-writing/SKILL.md): 이슈·브랜치·커밋·PR 작성법과 템플릿
- [std-testing](../std-testing/SKILL.md): 테스트 작성과 실행(앱 리포)

## 1. 이슈 등록

- GitHub 원격 주소와 `gh api user --jq .login`을 확인한다. 기대 계정은 `sirloinbh`이다. 다른 계정이면 인증을 바로잡기 전에 원격 변경을 하지 않는다.
- 사용자가 지정한 이슈나, 같은 요청으로 이미 등록한 이슈를 재사용한다. 재시도 전에 기존 결과를 확인해 중복 이슈를 만들지 않는다.
- 새 이슈는 std-backlog의 세분화·라벨 규칙과 std-git-writing의 이슈 템플릿으로 쓴다. 이슈카드는 GitHub Issue를 뜻한다. 별도 Projects 보드를 지정하지 않았다면 보드를 만들거나 연결하지 않는다.
- 본문은 UTF-8 임시 파일로 써서 `--body-file`로 등록한다. 토큰과 비밀값은 넣지 않는다.
- 발급된 실제 이슈 번호와 URL을 보관한다. 등록이 실패하면 번호를 임의로 만들거나 코드 변경을 먼저 시작하지 않는다.

## 2. 이슈 번호로 브랜치 만들기

- 작업 트리와 현재 브랜치를 확인한다. 다른 작업의 변경이 있으면 보존하고 작업끼리 섞지 않는다.
- 기본 대상 브랜치는 `main`이다. 관련 없는 미병합 브랜치에서 새 작업을 시작하지 않는다. 깨끗한 작업 트리에서 원격 main을 fetch하고 그 기준으로 분기한다.
- 브랜치 이름은 std-git-writing의 규칙(`<type>/<번호>-<영문-요약>`)을 따른다.
- 같은 이슈 브랜치가 이미 있으면 상태를 확인하고 이어서 쓴다.
- 변경과 커밋은 이 브랜치에서 한다. `main`에 직접 커밋하거나 푸시하지 않는다.

## 3. 구현과 커밋별 docs 기록

- 앱 리포에서는 std-testing을 읽고 관련 테스트를 함께 작성·수정한다. 버그 수정에는 회귀 테스트를 추가한다. 구현·테스트·docs는 같은 커밋에 포함하고, 커밋 전에 관련 테스트를 실행한다.
- 요청한 범위만 구현한다. 개발 기반 정리 작업은 std-foundation을 함께 읽는다.
- `docs/changes/<번호>-<slug>.md`를 만들고 이슈 링크, 목적, 변경 내용, 검증, 제한·후속 작업을 기록한다.
- **각 작업 커밋에 그 커밋의 변경과 검증을 docs에 함께 기록한다.** 한 이슈 문서에 항목을 누적해도 된다.
- 변경 이유와 관찰된 결과를 남긴다. 실행하지 않은 검사나 배포를 완료했다고 쓰지 않는다.
- 커밋 메시지는 std-git-writing의 형식(`<type>: <무엇을 했는지> (#번호)`)을 따른다.
- stage 전에 diff와 비밀정보 포함 여부를 확인하고, 관련 파일만 명시해서 stage한다.

## 4. 테스트 후 PR 만들기

- PR을 만들거나 갱신하기 전에 최종 변경의 관련 테스트와 필수 검사를 실행한다. 필수 명령과 DB 통합 테스트 조건은 프로젝트 `AGENTS.md`를 따른다.
- 실패를 고치고, 실행하지 못한 검사·건너뛴 DB 테스트·미완료 브라우저 검증을 구분해 docs와 PR에 기록한다. 필요한 검증이 막히면 PR은 draft로 만든다.
- 작업 브랜치만 푸시한다. PR 대상은 이 리포의 `main`이다. subtree 동기화 스크립트는 main과 하위 저장소에 푸시하므로 이 단계에서 쓰지 않는다.
- 같은 head 브랜치의 PR이 있으면 갱신하고 새로 만들지 않는다.
- PR 제목과 본문은 std-git-writing의 PR 템플릿으로 쓴다. 본문은 UTF-8 파일로 전달한다.
- GitHub Actions 결과를 확인하고 관련 실패를 해결한다. 아직 실행 중인 검사는 실행 중이라고 알린다.

## 5. 병합

- 누가 병합하는지는 프로젝트 `AGENTS.md`를 따른다. 정해져 있지 않으면 **사용자만 병합한다.**
- 사용자가 병합하는 리포: 이슈 URL, 브랜치, PR URL, 검증 결과, 남은 작업을 전달하고 PR을 열린 상태로 둔다. 자동 병합, merge queue 등록, 병합 API, main 직접 통합을 하지 않는다. 자신의 PR을 승인해 사용자 검토를 대신하지 않는다. 일반적인 "계속해"를 병합 권한으로 해석하지 않는다.
- 이슈는 PR 병합으로 닫히게 둔다.

## 인증·실패 처리

이미 주어진 이슈·푸시·PR 권한을 불필요하게 다시 묻지 않는다. 도구가 요구하는 실행 권한과 GitHub 인증은 지킨다. 실패하면 완료한 단계부터 다시 시작하고, 원격 생성 결과가 불명확하면 조회한 뒤 재시도한다. 계정·인증 문제를 다른 계정으로 우회하지 않는다.
