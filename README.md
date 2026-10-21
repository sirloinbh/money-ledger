# 가계부·자산 포트폴리오

수입과 지출, 자산 포트폴리오를 기록하고 흐름을 확인하는 개인 서비스입니다. 사용자는 본인 한 명이며 로그인 없이 로컬에서 사용합니다.

## 개발 기준

Node.js **24.21.0**, npm **11.19.0**. 설치는 `npm ci --ignore-scripts`(사용자 확인 후), 포맷은 `npm run format`, 전체 검증은 `npm run check`입니다. 전체 기준은 [개발 환경 설정 문서](docs/project-setup.md)와 [AGENTS.md](AGENTS.md)를 따릅니다.

변경은 **GitHub 이슈 → 이슈 번호 브랜치 → 구현·테스트·docs 기록 → `npm run check` → PR → CI 통과 후 에이전트 병합** 순서로 진행합니다.

## 실행

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

접속: http://localhost:8095 . `.env`의 비밀번호를 바꾼 뒤 실행하세요. 데이터는 `money-ledger-data` 볼륨에 저장되며 `docker compose down -v`는 데이터를 삭제합니다.

개발 실행:

```powershell
docker compose up -d db
npm run dev
```

Vite http://localhost:5175, API http://localhost:3015/api/health, 호스트 DB 포트 55445.

## 검증

- `npm run check`: 포맷, lint, 타입, 테스트, 스킬 동기화 검사, 빌드.
- DB 통합 테스트는 마이그레이션을 적용한 전용 테스트 DB의 `TEST_DATABASE_URL`이 필요합니다. 없으면 건너뜁니다.
- GitHub Actions가 PostgreSQL 서비스로 전체 검사를 실행하고 Docker 이미지를 빌드합니다.

## 저장소 구성

이 저장소는 전체 소스를 담은 우산 모노레포입니다. `frontend`, `backend`, `database`는 `git subtree split`으로 배포용 비공개 저장소 `money-ledger-frontend`, `money-ledger-backend`, `money-ledger-db`에 동기화합니다(`scripts/push-repositories.ps1`, 요청 시에만). AWS 인프라는 공유 저장소 `shared-aws-infrastructure`에서 관리합니다.

## 문서

- [AI 지침](AGENTS.md) · [Claude 지침](CLAUDE.md) · [DB](database/README.md)
- [변경 기록](docs/changes/README.md) · [일일 기록](docs/daily/README.md) · [다음 작업](docs/next-steps/README.md)
