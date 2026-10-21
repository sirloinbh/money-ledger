# 가계부·자산 포트폴리오 프로젝트 지침

수입과 지출, 자산 포트폴리오를 기록하고 흐름을 확인하는 개인 서비스. 사용자는 본인 한 명이며 로그인은 없다. 외부 공개 전에는 사설 접속 또는 인증을 먼저 설계한다.

## 구현 작업 절차

기능 추가·수정·리팩터링·설정·문서·스킬 변경 요청에는 [money-ledger-implementation](skills/money-ledger-implementation/SKILL.md)을 읽고 적용한다.

1. `sirloinbh/money-ledger`에 이슈를 등록한다. 사용자가 지정한 기존 이슈가 있으면 재사용한다.
2. 이슈 번호를 포함한 작업 브랜치를 만든다: `<type>/<issue-number>-<slug>`.
3. 구현·수정과 관련 테스트를 함께 작성하고, 각 커밋에 `docs/changes/<issue-number>-<slug>.md` 변경 기록을 포함한다.
4. 커밋 전과 PR 생성·갱신 전에 `npm run check`를 실행하고 결과를 docs와 PR에 기록한다.
5. **PR을 올린 뒤 자동 코드 리뷰를 최대 2회 거치고, 최종 head의 필수 CI 검사가 모두 통과하면 에이전트(주 에이전트·로컬 워커)가 확인 없이 병합한다.** 리뷰에서 보완점이 나오면 추가 커밋으로 반영하고, 1차 보완 후에는 2차 리뷰를 한 번 더 받는다. 2차 보완 커밋 뒤에는 더 리뷰하지 않는다. 보완점이 없으면 바로 다음 단계로 간다. 이 PR에서 고치기에 큰 수정은 새 이슈카드로 분리한다. 상세 절차는 implementation 스킬을 따른다. 병합은 프로젝트 래퍼로 `pr merge <url> --merge --match-head-commit <검증한 head SHA>`(merge commit)를 실행하고 연결 이슈(`Closes #N`)가 닫혔는지 확인한다. 연속 PR은 순서대로 병합한다. 앞 PR 병합 후 다음 PR 브랜치에 `origin/main`을 병합해 충돌을 풀고, 관련 테스트를 다시 실행하고, 일반 푸시 후 CI 통과를 기다려 병합한다. 실패·실행 중 검사가 있는 PR 병합, `--admin` 등 브랜치 보호 우회, 자기 PR 승인으로 검토 대체, `main` 직접 커밋·푸시, 강제 푸시는 하지 않는다. 현재 `main` 병합은 배포를 일으키지 않는다(배포 미연결).

질문 답변·추천·읽기 전용 조사는 이슈나 브랜치를 만들지 않는다. 요구사항에 정해지지 않은 규칙(집계 방식, 정책, 범위)은 추천안과 함께 사용자에게 확인하고 이슈 코멘트로 기록한다.

## 프로젝트 기준

- 기술: React 19 + Vite + TypeScript, Express 5 + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions. Node 24.21.0 / npm 11.19.0.
- 포트(127.0.0.1 바인딩): 웹 8095, 호스트 DB 55445, API 3015, Vite 5175. 사용자 요청 없이 바꾸지 않는다.
- 날짜는 `YYYY-MM-DD`, 서비스 시간대는 `Asia/Seoul`. 서버의 "오늘"은 `serviceDate()`로 계산한다.
- 입력 검증과 판정은 서버에서도 수행한다. 여러 행 변경은 트랜잭션으로 처리한다. 사용자에게 보이는 검증 오류는 한국어 메시지로 지정한다.
- 마이그레이션은 `database/migrations` 한 곳에서 관리하고 재실행해도 안전하게 쓴다. 기존 DB 적용은 [DB 문서](database/README.md)의 `psql -f` 방식을 쓴다.
- `.env`, 인증 토큰, 실제 백업, Terraform state는 커밋하거나 docs·PR·로그에 기록하지 않는다.
- 사용자 변경을 덮어쓰지 않는다. 필요한 파일만 명시해서 stage한다.
- **npm 패키지 설치·삭제는 사용자 재확인 후에만 하고 `--ignore-scripts`를 우선한다.** `npm run <script>`, `npm ls`, `npm view`는 허용된다.
- GitHub 원격 작업은 개인 계정 `sirloinbh`의 `scripts/gh-project.ps1` 래퍼로 한다. 기본 회사 계정 `gh`로 원격 변경을 하지 않는다.
- `frontend`, `backend`, `database`의 하위 저장소는 배포용 subtree 대상이다. 일상 PR 작업 중 하위 저장소나 `main`에 직접 푸시하지 않는다. `scripts/push-repositories.ps1`은 별도 동기화 요청 시에만 쓴다. AWS 인프라는 공유 저장소 `sirloinbh/shared-aws-infrastructure`에서 관리한다.

## 스킬과 문서

- 구현·수정 테스트: [money-ledger-testing](skills/money-ledger-testing/SKILL.md). 새 기능은 관련 테스트, 버그 수정은 회귀 테스트를 함께 작성한다.
- 작업 절차: [money-ledger-implementation](skills/money-ledger-implementation/SKILL.md).
- 개발 기반: [money-ledger-foundation](skills/money-ledger-foundation/SKILL.md)과 [개발 환경 설정 기준](docs/project-setup.md).
- 스킬 원본은 `skills/`이다. Claude Code용 복제본 `.claude/skills/`는 직접 수정하지 않고 `npm run skills:sync`로 갱신한다.
- 작업 기록: `docs/changes/`. 일일 총정리: `docs/daily/YYYY-MM-DD.md`(목록은 `docs/daily/README.md`). 최신 다음 작업: `docs/next-steps/README.md`.

## 검증 명령

- 전체: `npm run check` (포맷 → lint → 타입 → 테스트 → 스킬 동기화 검사 → 빌드).
- DB 통합 테스트: 스키마를 준비한 전용 테스트 DB의 `TEST_DATABASE_URL`을 설정하고 `npm test`. 환경변수가 없으면 통합 테스트는 건너뛰므로 DB 검증 완료로 보고하지 않는다.
- 화면 변경: 모바일 390×844와 PC 1440×900에서 실제 브라우저로 확인하고 결과를 기록한다.
- 문서·스킬만 변경: 포맷·링크 검사와 skill-creator `quick_validate.py`(Windows는 `PYTHONUTF8=1`).
