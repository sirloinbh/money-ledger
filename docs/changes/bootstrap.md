# 초기 개발 환경 세팅 (이슈 이전)

- 일자: 2026-10-19 (Asia/Seoul)
- 기준: workout-memo의 [개발 환경 설정 문서](../project-setup.md) (workout-memo PR #57)

## 목적

money-ledger 프로젝트를 이슈 기반으로 개발할 수 있도록 개발 환경·최소 앱·검증·저장소를 준비한다. 세부 기능은 사용자가 이슈 카드를 등록한 뒤 진행한다.

## 내용

- 스택: React 19 + Vite + TypeScript, Express 5 + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions. Node 24.21.0 / npm 11.19.0.
- 의존성: workout-memo의 잠금 파일과 같은 패키지·버전만 사용했다(워크스페이스 이름만 변경). 사용자 승인에 따라 `npm ci --ignore-scripts`로 설치했고 새 패키지는 추가하지 않았다. `npm audit`: 0 vulnerabilities.
- 최소 앱: `GET /api/health`(DB 확인, 서비스 날짜), 한국어 404·500 오류 처리, 사이드바·페이지 헤더·상태 표시·빈 상태 화면, CSS 변수 기반 디자인 토큰.
- DB: `database/migrations/001_initial.sql`(재실행 안전한 `app_settings`). 기존 DB 적용은 `psql -f` 방식만 안내한다.
- 테스트: 단위(`health.test.ts`), DB 통합(`db.integration.test.ts`, `TEST_DATABASE_URL` 없으면 건너뜀), UI(`app-ui.test.ts`, vm 하네스), 스킬 동기화 검사.
- AI 지침: `AGENTS.md`, `CLAUDE.md`, 스킬 3종(`skills/` 원본, `.claude/skills/` 복제본).
- 저장소: 우산 `sirloinbh/money-ledger` + 배포용 하위 저장소 `money-ledger-frontend`, `money-ledger-backend`, `money-ledger-db`(비공개, subtree). AWS는 공유 `shared-aws-infrastructure`.

## 검증

- 전용 테스트 DB `money_ledger_test`(workout-memo의 테스트 컨테이너)에 마이그레이션을 UTF-8로 적용하고 `npm run check` 실행: **exit 0**.
  - 앱·DB 테스트 **8 pass / 0 fail / 0 skip** (DB 통합 테스트 실제 실행)
  - 스킬 검사 **4 pass / 0 fail / 0 skip**
  - 포맷·lint·타입 통과, frontend/backend 빌드 통과
- 실제 브라우저 확인은 같은 템플릿으로 만든 study-log에서 수행했다(모바일 390px 가로 스크롤 없음, 상태·메뉴 전환 정상, PC 1440px 정상). 이 프로젝트는 제목·포트만 다르며 UI 테스트로 확인했다.
- 초기 커밋은 저장소 생성을 위해 `main`에 직접 푸시했다. 이후 모든 변경은 이슈 → 브랜치 → PR로 진행한다.
- Docker 이미지 빌드는 GitHub Actions의 `docker-build` 작업으로 확인한다. 로컬 `docker compose up`은 실행하지 않았다.
