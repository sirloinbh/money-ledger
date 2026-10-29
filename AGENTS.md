<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/에서 -->
# 가계부·자산 포트폴리오 프로젝트 지침

수입과 지출, 자산 포트폴리오를 기록하고 흐름을 확인하는 개인 서비스. 사용자는 본인 한 명이며 로그인은 없다. 외부 공개 전에는 사설 접속 또는 인증을 먼저 설계한다.

이 파일은 모든 앱이 함께 쓰는 공통 지침이다. 이 프로젝트에만 해당하는 규칙(도메인 규칙, 추가 검증 명령, 고유 스킬)은 **[AGENTS.project.md](AGENTS.project.md)를 반드시 함께 읽고 따른다.** 두 파일이 다르면 AGENTS.project.md가 우선한다.

## 구현 작업 절차

기능 추가·수정·리팩터링·설정·문서·스킬 변경 요청에는 [std-implementation](skills/std-implementation/SKILL.md)을 읽고 적용한다. 요구사항을 이슈로 나누고 다음 작업을 고를 때는 [std-backlog](skills/std-backlog/SKILL.md), 이슈·브랜치·커밋·PR을 쓸 때는 [std-git-writing](skills/std-git-writing/SKILL.md)을 따른다. 사용자에게 하는 설명은 [std-communication](skills/std-communication/SKILL.md)대로 한국어로 쓴다.

1. `sirloinbh/money-ledger`에 이슈를 등록한다. 사용자가 지정한 기존 이슈가 있으면 재사용한다.
2. 이슈 번호를 포함한 작업 브랜치를 만든다: `<type>/<issue-number>-<slug>`.
3. 구현·수정과 관련 테스트를 함께 작성하고, 각 커밋에 `docs/changes/<issue-number>-<slug>.md` 변경 기록을 포함한다.
4. 커밋 전과 PR 생성·갱신 전에 `npm run check`를 실행하고 결과를 docs와 PR에 기록한다.
5. PR 리뷰와 병합 규칙은 [AGENTS.project.md](AGENTS.project.md)를 따른다. 거기에 정해져 있지 않으면 **PR 병합은 사용자만 수행한다.** main 병합은 곧 운영 배포다. 정해진 규칙 밖에서 에이전트가 병합·자동 병합·승인으로 병합을 대신하지 않는다. 에이전트 워커(project-standards `tools/agents`)가 여는 PR은 이 리포 `.agents.json`의 `autoMerge`를 따른다(파일이 없으면 자동 병합, 리포별 값은 project-standards `docs/tools.md`).

질문 답변·추천·읽기 전용 조사는 이슈나 브랜치를 만들지 않는다. 요구사항에 정해지지 않은 규칙(집계 방식, 정책, 범위)은 추천안과 함께 사용자에게 확인하고 이슈 코멘트로 기록한다.

## 프로젝트 기준

- 기술: React + Vite + TypeScript, Express + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions. Node 24.21.0 / npm 11.19.0.
- 포트(127.0.0.1 바인딩): 웹 8105, API 3105, Vite 5205, 호스트 DB 15405, e2e API 3205, e2e 웹 5305. 포트는 중앙 레지스트리(`sirloinbh/project-standards`의 `registry/projects.json`) 값이며, 바꾸려면 중앙 리포에 이슈를 연다.
- DB 이름: `money`, 테스트 DB: `money_test`.
- 날짜는 `YYYY-MM-DD`, 서비스 시간대는 `Asia/Seoul`이다.
- 입력 검증과 판정은 서버에서도 수행한다. 여러 행 변경은 트랜잭션으로 처리한다. 사용자에게 보이는 검증 오류는 한국어 메시지로 지정한다.
- 마이그레이션은 `database/migrations` 한 곳에서 관리하고 재실행해도 안전하게 쓴다. 적용 절차는 [DB 문서](database/README.md)를 따른다.
- `.env`, 인증 토큰, 실제 백업, Terraform state는 커밋하거나 docs·PR·로그에 기록하지 않는다.
- 사용자 변경을 덮어쓰지 않는다. 필요한 파일만 명시해서 stage한다.
- **npm 패키지 설치·삭제는 사용자 재확인 후에만 하고 `--ignore-scripts`를 우선한다.** `npm run <script>`, `npm ls`, `npm view`는 허용된다.
- GitHub 원격 작업은 개인 계정 `sirloinbh`의 `scripts/gh-project.ps1` 래퍼로 한다. 기본 회사 계정 `gh`로 원격 변경을 하지 않는다.
- `frontend`, `backend`, `database`의 하위 저장소는 배포용 subtree 대상이다. 일상 PR 작업 중 하위 저장소나 `main`에 직접 푸시하지 않는다. `scripts/push-repositories.ps1`은 별도 동기화 요청 시에만 쓴다. AWS 인프라는 공유 저장소 `sirloinbh/shared-aws-infrastructure`에서 관리한다.

## 중앙 관리 파일

- 파일 첫 줄에 "중앙 관리 파일"이라고 적힌 파일과 `.standards/manifest.json`에 있는 파일은 `sirloinbh/project-standards`가 관리한다. 이 리포에서 직접 고치면 CI의 `standards-check`가 실패한다. 고칠 내용은 중앙 리포에 이슈와 PR로 올린다.
- `.gitignore`, `.prettierignore`처럼 `# --- project ---` 줄이 있는 파일은 그 줄 아래만 이 프로젝트가 고칠 수 있다.

## 스킬과 문서

- 공통 스킬(중앙 관리): [std-implementation](skills/std-implementation/SKILL.md), [std-testing](skills/std-testing/SKILL.md), [std-foundation](skills/std-foundation/SKILL.md), [std-backlog](skills/std-backlog/SKILL.md), [std-git-writing](skills/std-git-writing/SKILL.md), [std-communication](skills/std-communication/SKILL.md).
- 고유 스킬은 `skills/` 아래 `std-`로 시작하지 않는 폴더이며 [AGENTS.project.md](AGENTS.project.md)에 목록이 있다.
- 스킬 원본은 `skills/`이다. Claude Code용 복제본 `.claude/skills/`는 직접 수정하지 않고 `npm run skills:sync`로 갱신한다.
- 작업 기록: `docs/changes/`. 일일 총정리: `docs/daily/YYYY-MM-DD.md`(목록은 `docs/daily/README.md`). 최신 다음 작업: `docs/next-steps/README.md`.

## 검증 명령

- 전체: `npm run check`.
- DB 통합 테스트: 스키마를 준비한 전용 테스트 DB의 `TEST_DATABASE_URL`을 설정하고 `npm test`. 환경변수가 없으면 통합 테스트는 건너뛰므로 DB 검증 완료로 보고하지 않는다.
- 화면 변경: 모바일 390×844와 PC 1440×900에서 실제 브라우저로 확인하고 결과를 기록한다.
- 문서·스킬만 변경: 포맷·링크 검사와 skill-creator `quick_validate.py`(Windows는 `PYTHONUTF8=1`).
- 아직 설치하지 않은 도구의 명령을 실행 가능한 것으로 표시하지 않는다.
