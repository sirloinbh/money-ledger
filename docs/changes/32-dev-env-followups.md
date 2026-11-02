# #32 개발 환경 설정에서 남은 문제 기록

- 이슈: [#32](https://github.com/sirloinbh/money-ledger/issues/32)
- 브랜치: `docs/32-dev-env-followups`

## 목적

2026-11-02에 중앙 표준(`sirloinbh/project-standards`) 기준으로 작업 PC의 개발 환경을 설정했다. 남은 문제는 사용자 결정에 따라 뒤로 미루고, 이 문서에 원인과 해결 방법을 기록한다. 이번 변경은 문서만 바꾸며 문제를 고치지 않는다.

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
- 영향: `npm run dev`와 `docker compose`가 DB 접속 정보를 받지 못한다. `DATABASE_URL`이 없으면 `/api/health` 요청이 응답 없이 시간 초과된다.
- 해결: 사용자가 직접 만든다. 명령은 아래 "복구 순서"에 있다.

### 4. API가 3105 포트를 열지 못해도 성공 메시지를 출력한다

- 원인: `backend/src/server.ts`의 `listen` 콜백이 오류 인자를 확인하지 않는다. Express 5는 포트를 열지 못한 오류도 이 콜백으로 넘긴다.
- 재현: 2026-11-02에 브라우저의 외부 연결이 우연히 로컬 포트 3105를 쓰고 있었다. `0.0.0.0:3105`를 열면 `EADDRINUSE`가 났다. 그런데도 API는 `API http://localhost:3105`를 출력했고, Vite 프록시 요청은 `ECONNREFUSED`로 실패했다.
- 영향: 포트 충돌이 정상 실행처럼 보여 원인을 찾기 어렵다. 포트 충돌 자체는 해당 연결이 끊기면 사라진다.
- 해결: `listen` 콜백에서 오류를 확인해 메시지를 남기고 종료하도록 고치고 회귀 테스트를 추가한다. 코드 변경이므로 별도 이슈로 진행한다.

### 5. 로컬 `main`이 원격과 갈라져 있다

- 원인: 원격 이력이 다시 쓰였다. 로컬 `main`(`ea9a8a2`)과 원격 첫 커밋(`1087ae2`)은 트리가 같고 작성자 정보만 다르다. 그래서 `git pull --ff-only`가 실패한다.
- 영향: 표준의 병합 후 정리 절차(`git switch main`, `git pull --ff-only`)를 쓸 수 없다. PR #2로 병합된 로컬 브랜치 `chore/1-agent-auto-merge`도 남아 있다. 새 작업은 `origin/main`에서 분기하므로 막히지 않는다.
- 해결: 표준상 사용자 승인이 필요한 명령이라 실행하지 않았다. 아래 "복구 순서"의 명령을 사용자가 실행하거나 승인한다.

## 복구 순서

문제 1을 해결한 뒤 저장소 루트에서 실행한다.

```powershell
# 문제 3: 복사한 뒤 POSTGRES_PASSWORD와 DATABASE_URL의 비밀번호를 같은 값으로 바꾼다
Copy-Item .env.example .env

# 문제 2: 전용 테스트 DB를 만들고 이 터미널에서만 지정한다
docker compose up -d db
docker compose exec -T db psql -U money -d money -c "CREATE DATABASE money_test"
docker compose exec -T db psql -U money -d money_test -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/001_initial.sql
$env:TEST_DATABASE_URL = 'postgres://money:<비밀번호>@localhost:15405/money_test'
npm run check

# 전체 앱 실행: 이미지 빌드에 패키지 토큰이 필요하다
$env:NODE_AUTH_TOKEN = (ghp auth token)
docker compose up --build -d
Remove-Item Env:NODE_AUTH_TOKEN
```

```powershell
# 문제 5: 사용자 승인이 필요하다. main이 아닌 브랜치에서 커밋하지 않은 변경 없이 실행한다
git branch -f main origin/main
git switch main
git branch -D chore/1-agent-auto-merge
```

## 검증

문서만 바꿨다. 앱 코드와 테스트는 바꾸지 않았다.

- `npm run check`: 통과. `TEST_DATABASE_URL`을 이 명령에서만 비워 다른 앱의 DB를 쓰지 않게 했다. 백엔드 6개 중 5개 통과, 1개 건너뜀(DB 통합 테스트). 프론트엔드 60개 중 58개 통과, 2개 건너뜀. 스킬 테스트 4개 통과.
- DB 통합 테스트는 PR CI로 확인한다.
