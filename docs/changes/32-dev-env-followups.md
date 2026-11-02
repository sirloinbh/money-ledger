# #32 개발 환경 설정에서 남은 문제 기록

- 이슈: [#32](https://github.com/sirloinbh/money-ledger/issues/32)
- 브랜치: `docs/32-dev-env-followups`

## 목적

2026-11-02에 중앙 표준(`sirloinbh/project-standards`) 기준으로 작업 PC의 개발 환경을 설정했다. 남은 문제는 사용자 결정에 따라 뒤로 미루고, 이 문서에 원인과 해결 방법을 기록한다. 이번 변경은 문서만 바꾸며 문제를 고치지 않는다.

## 변경 — 2026-11-02

- `docs/changes/32-dev-env-followups.md`: 설정 결과, 남은 문제 5건, 복구 순서를 기록했다.
- `docs/next-steps/README.md`: "개발 환경 후속 작업" 표를 추가했다.
- `docs/daily/2026-11-02.md`, `docs/daily/README.md`: 일일 기록과 목록을 추가했다.

## 설정 결과 — 2026-11-02

- 작업 폴더를 최신 `origin/main`(`14249b6`)으로 옮겼다. 로컬은 53커밋 뒤처져 있었다.
- `npm ci --ignore-scripts`로 패키지 474개를 설치했다. 잠금 파일은 바뀌지 않았다. 패키지 토큰(`NODE_AUTH_TOKEN`)은 설치 명령에만 쓰고 저장하지 않았다.
- Node 24.21.0, npm 11.19.0, Claude Code 2.1.316, GitHub 계정 `sirloinbh`를 확인했다.

| 확인 항목                 | 결과                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `npm run check`           | 통과. DB 통합 테스트는 다른 앱의 테스트 DB에서 실행됨(문제 2) |
| `npm run standards:check` | 통과(중앙 `b85f96f`)                                          |
| `npm run knip`            | 통과                                                          |
| Vite 화면(5205)           | 200 응답                                                      |
| API `/api/health`         | 임시 포트 13105와 다른 앱의 테스트 DB로 200 응답              |
| Vite 프록시를 거친 API    | 확인 못 함(문제 4)                                            |
| Docker Compose 실행       | 확인 못 함(문제 1)                                            |
| `money`, `money_test` DB  | 없음(문제 1)                                                  |

## 남은 문제

### 1. Docker Desktop이 시작되지 않는다

- 원인: 펌웨어(BIOS)에서 가상화가 꺼져 있다. 오류 코드는 `Wsl/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED`이다.
- 영향: `docker compose`로 DB와 전체 앱을 띄울 수 없고, 호스트 DB 포트 15405도 열리지 않는다.
- 해결: BIOS에서 가상화(AMD는 SVM Mode)를 켠다. 관리자 PowerShell에서 `wsl --install --no-distribution`을 실행하고 재부팅한다.

### 2. `TEST_DATABASE_URL`이 다른 앱의 테스트 DB를 가리킨다

- 원인: 이 PC의 사용자 환경변수가 `study_test`를 가리킨다.
- 영향: `npm run check`의 DB 통합 테스트가 그 DB에서 실행된다. 그 DB에 `app_settings` 테이블이 있어 테스트가 통과하므로, 이 프로젝트의 DB 검증으로 인정하지 않는다. 이 테스트와 `/api/health`는 조회만 하므로 데이터를 쓰지 않았다.
- 해결: 다른 앱이 쓸 수 있어 사용자 환경변수는 바꾸지 않는다. 이 프로젝트의 터미널에서만 `money_test`로 덮어쓴다. 명령은 아래 "복구 순서"에 있다.

### 3. `.env`가 없다

- 원인: 에이전트 세션의 보안 설정이 `.env` 접근을 막아 만들지 않았다.
- 영향: `npm run dev`와 `docker compose`가 DB 접속 정보를 받지 못한다. `DATABASE_URL`이 없으면 API가 `pg` 기본값인 `localhost:5432`로 접속을 시도한다. 이 PC에서는 인증에 실패해 `/api/health`가 500으로 응답한다.
- 해결: 사용자가 직접 만든다. 명령은 아래 "복구 순서"에 있다.

### 4. API가 3105 포트를 열지 못해도 성공 메시지를 출력한다

- 원인 1: `backend/src/server.ts`의 `listen` 콜백이 오류 인자를 확인하지 않는다. Express 5는 포트를 열지 못한 오류도 이 콜백으로 넘긴다.
- 원인 2: 이 PC의 TCP 동적 포트 범위가 1024~15000이다(`netsh int ipv4 show dynamicport tcp`). Windows 기본 시작값은 49152다. API 3105, Vite 5205, 웹 8105가 모두 이 범위에 들어 외부 연결과 겹칠 수 있다.
- 재현: 2026-11-02에 브라우저의 외부 연결이 로컬 포트 3105를 쓰고 있었다. `0.0.0.0:3105`를 열면 `EADDRINUSE`가 났다. 그런데도 API는 `API http://localhost:3105`를 출력했고, Vite 프록시 요청은 `ECONNREFUSED`로 실패했다.
- 영향: 포트 충돌이 정상 실행처럼 보여 원인을 찾기 어렵다. 해당 연결이 끊기면 충돌은 사라지지만 다시 생길 수 있다.
- 해결: `listen` 콜백에서 오류를 확인해 메시지를 남기고 실패 코드로 종료하도록 고치고 회귀 테스트를 추가한다. 코드 변경이므로 별도 이슈로 진행한다.
- 사용자 결정: 재발을 막으려면 관리자 권한으로 이 포트들을 `netsh int ipv4 add excludedportrange`로 제외하거나 동적 포트 범위를 되돌린다. 범위를 좁힌 이유를 모르므로 바꾸지 않았다.

### 5. 로컬 `main`이 원격과 갈라져 있다

- 원인: 원격 이력이 다시 쓰였다. 로컬 `main`(`ea9a8a2`)과 원격 첫 커밋(`1087ae2`)은 트리가 같고 작성자 정보만 다르다. 그래서 `git pull --ff-only`가 실패한다.
- 영향: 표준의 병합 후 정리 절차(`git switch main`, `git pull --ff-only`)를 쓸 수 없다. PR #2로 병합된 로컬 브랜치 `chore/1-agent-auto-merge`도 남아 있다. 새 작업은 `origin/main`에서 분기하므로 막히지 않는다.
- 해결: 표준상 사용자 승인이 필요한 명령이라 실행하지 않았다. 아래 "복구 순서"의 명령을 사용자가 실행하거나 승인한다.

## 복구 순서

Docker를 쓸 수 없어 아래 Docker 명령은 실행해 보지 못했다. 문제 1을 해결한 뒤 저장소 루트에서 단계별로 실행한다.

**1단계: `.env` 만들기(문제 3).** 복사한 뒤 `POSTGRES_PASSWORD`와 `DATABASE_URL`의 비밀번호를 같은 값으로 바꾼다. 다음 단계로 넘어가기 전에 바꿔야 한다. DB 이미지는 빈 볼륨을 처음 초기화할 때만 비밀번호를 설정하기 때문이다. 영문과 숫자만 쓰면 URL 인코딩이 필요 없다.

```powershell
Copy-Item .env.example .env
```

**2단계: 전용 테스트 DB 만들기(문제 2).** `<비밀번호>`는 1단계에서 정한 값이다. `money_test`는 자동 초기화 대상이 아니므로 마이그레이션을 직접 적용한다.

```powershell
docker compose up -d --wait db
docker compose exec -T db psql -U money -d money -c "CREATE DATABASE money_test"
docker compose exec -T db sh -c 'for f in /docker-entrypoint-initdb.d/*.sql; do psql -U money -d money_test -v ON_ERROR_STOP=1 -f "$f" || exit 1; done'
$env:TEST_DATABASE_URL = 'postgres://money:<비밀번호>@localhost:15405/money_test'
npm run check
```

**3단계: 전체 앱 실행.** 이미지 빌드에 패키지 토큰이 필요하다.

```powershell
$env:NODE_AUTH_TOKEN = (powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gh-project.ps1 auth token)
docker compose up --build -d
Remove-Item Env:NODE_AUTH_TOKEN
```

**4단계: 로컬 브랜치 정리(문제 5).** 사용자 승인이 필요하다. `main`이 아닌 브랜치에서 커밋하지 않은 변경이 없을 때 실행한다.

```powershell
git branch --force main origin/main
git switch main
git branch --delete --force chore/1-agent-auto-merge
```

## 검증

문서만 바꿨다. 앱 코드와 테스트는 바꾸지 않았다.

- `npm run check`: 통과. `TEST_DATABASE_URL`을 이 명령에서만 비워 다른 앱의 DB를 쓰지 않게 했다. 백엔드 6개 중 5개 통과, 1개 건너뜀(DB 통합 테스트). 프론트엔드 60개 중 58개 통과, 2개 건너뜀. 스킬 테스트 4개 통과.
- DB 통합 테스트는 PR CI로 확인한다.
- 복구 순서의 Docker 명령은 실행하지 못했다(문제 1). 근거는 `compose.yaml`과 `database/README.md`다.

## 리뷰 기록

### 1차 — 보완점 8건, 모두 추가 커밋으로 반영

- `ghp`가 프로필 없는 셸에 없어 `scripts/gh-project.ps1` 래퍼로 바꿨다.
- DB가 준비되기 전에 `psql`이 실행될 수 있어 `docker compose up -d --wait db`로 바꿨다.
- `DATABASE_URL`이 없을 때 시간 초과된다는 설명이 틀려 500 응답으로 고쳤다.
- `001`만 적용하던 명령을 모든 마이그레이션을 이름순으로 적용하게 바꿨다.
- 포트 충돌의 원인으로 동적 포트 범위 1024~15000을 추가했다.
- 정해진 형식에 맞춰 "변경" 절을 추가했다.
- 비밀번호를 고치기 전에 DB가 초기화되지 않도록 복구 순서를 단계로 나눴다.
- git 명령을 표준의 긴 옵션으로 바꿨다.
