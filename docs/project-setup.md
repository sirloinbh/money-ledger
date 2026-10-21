# 새 웹앱 프로젝트 개발 환경 설정 — AI 에이전트 인계 문서

이 문서는 **새 웹앱 프로젝트를 세팅할 AI 에이전트**(Claude Code, Codex 등)에게 그대로 전달하는 지침이다. `sirloinbh/workout-memo`에서 실제로 운영·검증한 개발 환경을 기준으로 작성했다. 에이전트는 이 문서를 처음부터 끝까지 읽은 뒤 [11. 부트스트랩 체크리스트](#11-부트스트랩-체크리스트) 순서대로 진행한다.

- 기준일: 2026-10-19 (Asia/Seoul). 버전 번호는 이날 기준으로 실제 동작을 확인한 값이다. 새 프로젝트를 시작할 때 공식 지원 상태를 다시 확인하고, 바꾸면 이유를 기록한다.
- 표기: **[현재 적용]**은 workout-memo에 실제 설치·사용 중인 것, **[추천·미도입]**은 검토만 했고 아직 설치하지 않은 것이다. 미도입 도구를 설치 완료된 것처럼 다루지 않는다.

## 0. 시작 전에 사용자에게 확인할 값

아래 자리표시자는 프로젝트마다 다르다. 값이 정해지지 않았으면 **세팅을 시작하기 전에 사용자에게 묻는다.** 임의로 정하지 않는다.

| 자리표시자       | 의미                                  | workout-memo 예시                                            |
| ---------------- | ------------------------------------- | ------------------------------------------------------------ |
| `<app>`          | 앱·저장소 기본 이름(소문자, 하이픈)   | `workout-memo`                                               |
| `<App 표시명>`   | 화면·문서에 쓰는 이름                 | `FORM · 나의 운동 기록`                                      |
| `<owner>`        | GitHub 계정(개인/조직)                | `sirloinbh`                                                  |
| `<db>`           | PostgreSQL DB·사용자 이름             | `workout`                                                    |
| `<web-port>`     | 운영형 로컬 웹 포트(127.0.0.1 바인딩) | `8088` (8080 등 흔한 포트와 충돌 방지)                       |
| `<db-port>`      | 호스트에서 접속하는 DB 포트           | `55432` (기본 5432 충돌 방지)                                |
| `<api-port>`     | API 내부 포트                         | `3001`                                                       |
| `<timezone>`     | 서비스 기준 시간대                    | `Asia/Seoul`                                                 |
| `<region>`       | AWS 리전                              | `ap-northeast-2` (서울)                                      |
| `<budget-usd>`   | 월 AWS 예산 알림 기준                 | `20`                                                         |
| 사용자·로그인    | 사용자 수, 로그인 필요 여부           | 1인용, 로그인 없음 → 외부 공개 금지                          |
| 도메인 규칙      | 날짜·단위·미확인 값 처리 등 핵심 규칙 | 날짜 `YYYY-MM-DD`, 중량은 총중량 kg, 확인하지 못한 값은 NULL |
| GitHub 계정 분리 | 회사 계정과 개인 계정을 섞어 쓰는지   | 기본 `gh`는 회사 계정, 이 프로젝트는 개인 계정 래퍼 사용     |

## 1. 절대 규칙 (에이전트 행동 제약)

새 프로젝트의 `AGENTS.md`에도 그대로 옮긴다.

1. **npm 패키지 설치·삭제는 사용자 재확인 후에만 한다.** 2025~2026 npm 공급망 공격(Shai-Hulud 계열)이 `postinstall` 훅으로 토큰을 빼낸다. `npm install/i/add/uninstall/update/ci`, `npx <패키지>`, `pnpm/yarn/bun install`, `corepack enable/prepare`가 모두 해당한다. 설치가 필요하면 다음 순서를 따른다.
   - 패키지 목록과 게시자·최근 릴리스·GitHub 저장소를 사용자에게 보여주고, socket.dev·Snyk Advisor·deps.dev 확인을 권한다.
   - 사용자가 "위험을 인지했으니 진행"이라고 명시하면 실행한다. `--ignore-scripts`를 먼저 제안한다.
   - 빌드에 설치 스크립트가 꼭 필요한 패키지(예: `esbuild`)만 `package.json`의 `allowScripts`에 명시한다.
   - `npm run <script>`, `npm ls`, `npm view`처럼 설치를 동반하지 않는 명령은 허용된다.
2. **PR은 자동 코드 리뷰를 최대 2회 거치고 필수 CI 검사가 모두 통과한 뒤 에이전트가 병합한다.** 리뷰에서 보완점이 나오면 추가 커밋으로 반영하고, 1차 보완 후에는 2차 리뷰를 한 번 더 받는다. 2차 보완 커밋 뒤에는 더 리뷰하지 않는다. 보완점이 없으면 바로 다음 단계로 간다. 이 PR에서 고치기에 큰 수정은 새 이슈카드로 분리한다. 확인을 다시 묻지 않고 프로젝트 래퍼로 `pr merge <url> --merge --match-head-commit <검증한 head SHA>`(merge commit)를 실행하고, 연결 이슈가 닫혔는지 확인한다. 실패·실행 중 검사가 있는 PR 병합, `--admin` 등 브랜치 보호 우회, 자기 PR 승인으로 검토 대체, `main` 직접 커밋·푸시, 강제 푸시는 하지 않는다.
3. **비밀값은 저장소·문서·PR·로그에 넣지 않는다.** `.env`, 토큰, 실제 백업, Terraform state가 해당한다. `.env.example`만 커밋한다.
4. **사용자 변경을 덮어쓰지 않는다.** `git add -A`를 쓰지 말고 파일을 명시해서 stage한다. 되돌리기·삭제 전에 대상을 확인한다.
5. **실행하지 않은 검사를 통과로 보고하지 않는다.** 건너뛴 DB 테스트, 미실행 브라우저 확인, 미배포를 구분해 기록한다.
6. **요구사항이 비어 있으면 묻는다.** 구현 전에 정해야 할 규칙(집계 방식, 정책, 범위)은 추천안과 함께 사용자에게 확인하고 이슈에 기록한다.

## 2. 언어와 문서 규칙

- 사용자 대화, 화면 문구, 문서(README·docs·이슈·PR)는 **한국어**로 쓴다. 코드 식별자, 커밋 제목 접두어(`feat:` 등), 코드 주석은 영어를 기본으로 한다.
- 서버 검증 오류 메시지도 사용자에게 보이면 한국어로 지정한다. Zod 기본 영어 메시지("Array must contain…")가 화면에 그대로 노출되지 않게 `.min(1, '…')`처럼 메시지를 준다.
- 날짜는 `YYYY-MM-DD`, 서비스 시간대는 `<timezone>`. 서버의 "오늘"은 서버 시간대가 아니라 서비스 시간대로 계산한다.
- 문서 위치:
  - `docs/changes/<이슈번호>-<slug>.md`: 이슈별 변경 기록. 목적, 변경, 실제 검증 명령과 pass/fail/skip, 한계를 남긴다.
  - `docs/daily/YYYY-MM-DD.md`: 작업일 총정리. 날짜별로 누적하고 `docs/daily/README.md`에 목록을 추가한다.
  - `docs/next-steps/README.md`: 최신 우선순위·차단·다음 행동. 매일 갱신한다.

## 3. 기술 스택

### 3.1 [현재 적용] 버전과 역할

| 영역        | 선택                                                | 버전(고정/범위)                                         | 역할                                         |
| ----------- | --------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| 런타임      | Node.js / npm                                       | `24.21.0` / `11.19.0` (정확히 고정)                     | 개발·CI·Docker 모두 동일                     |
| 패키지 구조 | npm workspaces                                      | 루트 + `frontend`, `backend`                            | 루트 잠금 파일 1개 + 하위 저장소용 잠금 파일 |
| 프론트엔드  | React, React DOM                                    | `^19.1.0`                                               | SPA                                          |
|             | Vite                                                | `^6.3.5`                                                | 개발 서버·빌드, `/api` 프록시                |
|             | TypeScript                                          | `^5.8.3`                                                | `strict`                                     |
|             | lucide-react                                        | `^0.468.0`                                              | 아이콘                                       |
| 백엔드      | Express                                             | `^5.1.0`                                                | REST API                                     |
|             | pg (node-postgres)                                  | `^8.16.0`                                               | SQL 직접 작성, ORM 없음                      |
|             | Zod                                                 | `^3.25.0`                                               | 서버 입력 검증                               |
|             | tsx                                                 | `^4.19.0`                                               | 개발 실행(`watch`)·테스트 실행               |
| DB          | PostgreSQL                                          | `17` (`postgres:17-alpine`)                             | 단일 DB                                      |
| 웹 서버     | nginx                                               | `1.27-alpine`                                           | 정적 파일 + `/api` 리버스 프록시             |
| 코드 품질   | ESLint / typescript-eslint / react-hooks / Prettier | `10.12.0` / `8.71.2` / `7.1.1` / `3.9.10` (정확히 고정) | 경고도 실패 처리                             |
|             | `@eslint/js`, `eslint-config-prettier`, `globals`   | `10.0.1`, `10.1.8`, `16.5.0`                            |                                              |
| 개발 편의   | concurrently                                        | `^9.2.0`                                                | API·웹 동시 실행                             |
| 테스트      | `node:test` + `tsx --test`                          | Node 내장                                               | 단위·DB 통합·UI(아래 6장)                    |
| 컨테이너    | Docker Compose                                      | —                                                       | db·api·web 3개 서비스                        |
| CI          | GitHub Actions                                      | —                                                       | 전체 검사 + DB 통합 + Docker 빌드            |
| 인프라      | Terraform / AWS provider                            | `>= 1.6.0` / `~> 5.0`                                   | ECR·예산 알림(배포는 미연결)                 |

### 3.2 [추천·미도입] 필요할 때 도입할 후보

| 영역      | 후보                                      | 도입 시점                                                                    |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| 라우팅    | React Router                              | 화면이 4~5개를 넘고 URL 공유·뒤로가기가 필요할 때                            |
| 서버 상태 | TanStack Query                            | 조회·캐시·저장 후 갱신 코드가 반복될 때                                      |
| 폼        | React Hook Form + Zod                     | 배열 입력과 항목별 오류가 복잡해질 때                                        |
| UI        | Tailwind CSS + shadcn/ui                  | 공통 컴포넌트가 늘 때. 기존 디자인 토큰을 먼저 옮긴다                        |
| 차트      | Recharts                                  | 직접 그린 SVG 차트로 부족할 때                                               |
| 테스트    | Vitest, React Testing Library, Playwright | 브라우저 자동 회귀가 필요할 때. 기존 `node:test`를 이유 없이 갈아엎지 않는다 |
| API 계약  | OpenAPI                                   | 외부 클라이언트가 생길 때                                                    |
| ORM       | Prisma                                    | 사용자가 ORM 전환을 요청할 때만. 마이그레이션 원본을 둘로 나누지 않는다      |

새 프로젝트에서 처음부터 위 후보를 쓰고 싶다면 1장 1번 규칙대로 사용자 확인을 받은 뒤 도입한다. 도입하면 실행 명령·CI·문서를 같은 PR에서 맞춘다.

## 4. 저장소 구조와 리포지토리 분화

### 4.1 우산 모노레포 + 배포용 하위 저장소

- 모든 소스는 **우산 모노레포 `<owner>/<app>` 하나에서 개발한다.** 이슈·브랜치·PR·리뷰가 모두 여기서 일어난다.
- 영역별 저장소 4개는 `git subtree split`으로 **배포·공유용으로만** 동기화한다. 일상 PR 작업 중에는 하위 저장소나 `main`에 직접 푸시하지 않는다.

| 접두 폴더         | 하위 저장소(비공개)                 | 내용                                      |
| ----------------- | ----------------------------------- | ----------------------------------------- |
| `frontend/`       | `<owner>/<app>-frontend`            | React 앱, Dockerfile, nginx.conf, 자체 CI |
| `backend/`        | `<owner>/<app>-backend`             | Express API, Dockerfile, 자체 CI          |
| `database/`       | `<owner>/<app>-db`                  | SQL 마이그레이션, README                  |
| `infrastructure/` | `<owner>/shared-aws-infrastructure` | 여러 앱이 공유하는 Terraform, 자체 CI     |

- 최초 생성: `scripts/create-repositories.ps1 -Owner <owner>`. 저장소 5개를 만들고 각 접두 폴더를 `export/<part>` 브랜치로 split해 하위 저장소의 `main`에 푸시한다.
- 동기화: `scripts/push-repositories.ps1`. **사용자가 동기화를 요청했을 때만** 실행한다(우산 `main`도 푸시하므로).
- 하위 저장소에서 직접 고쳤다면 먼저 `git subtree pull --prefix=<part> <url> main --squash`로 가져온다.
- 하위 저장소가 단독으로 빌드되도록 `frontend/`, `backend/`에는 각자의 `package-lock.json`, `.github/workflows/ci.yml`, `.gitignore`, `.dockerignore`를 둔다.

### 4.2 디렉터리 배치

```text
<app>/
├─ AGENTS.md                 # AI 공통 지침(Codex 기준, Claude도 참조)
├─ CLAUDE.md                 # [추천] "AGENTS.md를 따른다" + Claude 전용 차이
├─ README.md
├─ package.json              # workspaces, 공통 스크립트, 린트·포맷 도구
├─ package-lock.json
├─ .nvmrc / .node-version    # 24.21.0
├─ .npmrc  .editorconfig  .gitattributes  .gitignore
├─ .prettierrc.json  .prettierignore  eslint.config.mjs
├─ .env.example              # 비밀값 없는 예시만
├─ compose.yaml
├─ .github/workflows/ci.yml  # 통합 CI
├─ frontend/  backend/  database/  infrastructure/
├─ scripts/                  # 저장소 생성·동기화·백업·검사 스크립트
├─ skills/<app>-*/SKILL.md   # AI 작업 절차 원본
├─ .claude/skills/           # Claude Code용 복제본(npm run skills:sync)
└─ docs/  changes/  daily/  next-steps/
```

- `.local/`은 로컬 도구·임시 worktree·로그용이다. Git과 Prettier에서 제외한다.
- 기능이 커지면 `frontend/src/main.tsx` 하나에 모든 화면을 두지 말고 기능별 모듈(`routines.tsx`, `body.tsx` 등)로 나눈다. workout-memo는 `main.tsx`가 커져 동시 PR 충돌이 잦았다.

## 5. 핵심 설정 파일

아래는 workout-memo에서 쓰는 실제 내용이다. 이름·포트만 자리표시자로 바꾼다.

### 5.1 런타임·편집기·줄바꿈

`.nvmrc`, `.node-version`

```text
24.21.0
```

`.npmrc`: 엔진 불일치 설치 차단, 의존성 버전 정확히 저장.

```ini
engine-strict=true
save-exact=true
```

`.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.gitattributes`: 저장소는 LF, PowerShell 스크립트만 CRLF.

```text
* text=auto eol=lf
*.ps1 text eol=crlf
```

### 5.2 루트 `package.json`

```json
{
  "name": "<app>",
  "private": true,
  "workspaces": ["frontend", "backend"],
  "scripts": {
    "dev": "concurrently -k \"npm run dev -w backend\" \"npm run dev -w frontend\"",
    "build": "npm run build -w frontend && npm run build -w backend",
    "test": "npm run test -w backend",
    "test:skills": "node --test scripts/test/claude-skills.test.mjs",
    "skills:sync": "node scripts/claude-skills.mjs sync",
    "skills:check": "node scripts/claude-skills.mjs",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:skills && npm run build",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "npm run typecheck --workspaces"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "concurrently": "^9.2.0",
    "eslint": "10.12.0",
    "eslint-config-prettier": "10.1.8",
    "eslint-plugin-react-hooks": "7.1.1",
    "globals": "16.5.0",
    "prettier": "3.9.10",
    "typescript-eslint": "8.71.2"
  },
  "allowScripts": { "esbuild@0.28.2": true, "esbuild@0.25.12": true },
  "engines": { "node": "24.21.0", "npm": "11.19.0" },
  "packageManager": "npm@11.19.0"
}
```

`npm run check` 하나가 포맷 → 린트 → 타입 → 테스트 → 빌드를 모두 돈다. **커밋 전과 PR 생성·갱신 전에 반드시 실행한다.** 로컬 AI 워커를 두면 `test:agents`를 `check`에 추가한다(workout-memo 참고).

### 5.3 포맷·린트

`.prettierrc.json`

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

`.prettierignore`

```text
node_modules/
**/dist/
.local/
.git/
.env
package-lock.json
**/package-lock.json
infrastructure/.terraform/
**/*.tfstate*
backups/
.bkit/
.playwright-mcp/
```

`.bkit/`, `.playwright-mcp/`는 Claude Code 플러그인과 브라우저 도구가 만드는 로컬 산출물이다. Prettier가 이 폴더를 검사하면 `npm run check`가 실패한다.

`eslint.config.mjs`

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '.local/**', 'infrastructure/.terraform/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  prettier,
);
```

코드 규칙: React 컴포넌트와 타입은 PascalCase, 변수와 함수는 camelCase로 쓴다. 써야 하는데 안 쓰는 인자(Express 오류 미들웨어 등)는 `_` 접두를 붙인다. 오류 경계에서는 `unknown`으로 받아 필요한 필드만 확인한다.

### 5.4 `.gitignore`

```text
node_modules/
dist/
.env
*.log
.terraform/
*.tfstate*
*.tfplan
backups/
.local/
.bkit/
.playwright-mcp/
```

### 5.5 TypeScript

`frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`backend/tsconfig.json`(빌드)와 `backend/tsconfig.check.json`(테스트까지 타입 검사)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }
```

### 5.6 워크스페이스 `package.json` 스크립트

- frontend: `"dev": "vite --host 127.0.0.1"`, `"build": "tsc --noEmit && vite build"`, `"typecheck": "tsc --noEmit"`
- backend: `"dev": "tsx watch --env-file-if-exists=../.env src/server.ts"`, `"start": "node dist/server.js"`, `"build": "tsc"`, `"test": "tsx --test test/*.test.ts"`, `"typecheck": "tsc -p tsconfig.check.json"`
- 두 워크스페이스 모두 `engines`, `packageManager`, `"allowScripts": { "esbuild": true }`를 둔다.

`frontend/vite.config.ts`

```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': 'http://127.0.0.1:<api-port>' } } });
```

### 5.7 Docker Compose와 이미지

`compose.yaml`: 포트는 모두 `127.0.0.1`에만 바인딩한다(로그인 없는 앱 보호).

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-<db>}
      POSTGRES_USER: ${POSTGRES_USER:-<db>}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Copy .env.example to .env and set password}
      TZ: <timezone>
    ports: ['127.0.0.1:<db-port>:5432']
    volumes:
      - <app>-data:/var/lib/postgresql/data
      - ./database/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB']
      interval: 5s
      timeout: 5s
      retries: 15
    restart: unless-stopped
  api:
    build: ./backend
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-<db>}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-<db>}
      PORT: <api-port>
      TZ: <timezone>
    depends_on:
      db: { condition: service_healthy }
    restart: unless-stopped
  web:
    build: ./frontend
    ports: ['127.0.0.1:<web-port>:80']
    depends_on: [api]
    restart: unless-stopped
volumes:
  <app>-data:
```

`.env.example`

```ini
POSTGRES_DB=<db>
POSTGRES_USER=<db>
POSTGRES_PASSWORD=change-this-local-password
DATABASE_URL=postgres://<db>:change-this-local-password@localhost:<db-port>/<db>
PORT=<api-port>
```

`backend/Dockerfile`: 빌드와 실행을 나누고, 실행 단계는 비루트(`node`) 사용자로 돌린다.

```dockerfile
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --global npm@11.19.0
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE <api-port>
CMD ["node", "dist/server.js"]
```

`frontend/Dockerfile` + `frontend/nginx.conf`

```dockerfile
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --global npm@11.19.0
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  location /api/ { proxy_pass http://api:<api-port>; proxy_set_header Host $host; }
  location / { try_files $uri $uri/ /index.html; }
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy same-origin always;
}
```

## 6. 백엔드·DB 구현 규칙

### 6.1 API 구조

- `createApp(pool)`이 Express 앱을 만들어 반환하고, `server.ts`는 `listen`만 한다. 그러면 테스트가 실제 DB 풀 또는 가짜 풀로 앱을 띄울 수 있다. 테스트에서 "오늘"을 고정하려면 `createApp(pool, { today })`처럼 주입점을 둔다.
- `app.disable('x-powered-by')`, `express.json({ limit: '256kb' })`. 큰 업로드 경로(예: 백업 복원)만 그 경로에서 한도를 따로 올린다.
- 모든 입력은 Zod로 검증한 뒤 DB에 접근한다. 공통 오류 미들웨어가 `ZodError`는 400, 고유 제약 위반(23505)은 409로 바꾸고 한국어 메시지를 낸다.
- `GET /api/health`로 상태를 확인한다.
- pg의 `date` 타입(OID 1082)을 문자열로 받는다: `types.setTypeParser(1082, (v) => v)`. JS `Date`로 바뀌며 시간대가 밀리는 것을 막는다.
- 여러 행을 쓰는 변경(일지+세트 등)은 한 클라이언트에서 `BEGIN … COMMIT`으로 묶고, 오류 시 `ROLLBACK`, `finally`에서 `release()`한다.
- 모든 쿼리는 파라미터(`$1`)를 쓴다. 테이블·컬럼 이름을 문자열로 조립해야 하면 상수만 쓴다.

### 6.2 저장 안전성 패턴 (필요한 앱에 적용)

- **멱등 재시도:** 클라이언트가 POST/PUT에 UUID `Idempotency-Key`를 붙인다.
  - 서버는 트랜잭션 안에서 `pg_advisory_xact_lock(hashtextextended(key))`로 같은 키를 직렬화한다.
  - 요청 지문(메서드·대상·정규화한 본문의 SHA-256)과 응답을 저장해 같은 요청이면 같은 응답을 돌려준다.
  - 다른 내용에 같은 키를 쓰면 409로 거부한다.
- **동시 수정 충돌:** 행에 `version`을 두고 `SELECT … FOR UPDATE` 후 버전을 비교한다. 다르면 409, 같으면 `version+1`로 갱신한다.
- **브라우저 초안:** 입력 중인 내용을 `localStorage`에 보관(예: 7일)하고 저장 상태를 보여준다. 저장소 접근은 모두 `try/catch`로 감싼다(비공개 모드·용량 초과).

### 6.3 DB와 마이그레이션

- PostgreSQL 17. 마이그레이션 원본은 `database/migrations/NNN_<설명>.sql` **한 곳**에만 둔다.
- 번호는 3자리 순번으로 매긴다. **병렬 브랜치에서 같은 번호를 쓰지 않도록 작업 시작 시 번호를 예약한다.** workout-memo는 동시에 연 PR들이 `003`을 겹쳐 쓴 적이 있다.
- 모든 마이그레이션은 재실행해도 안전하게 쓴다: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, 시드 데이터는 `INSERT … ON CONFLICT DO NOTHING/UPDATE`.
- 기존 데이터의 의미를 보존한다. 예를 들어 새 `completed` 컬럼은 기본값을 `true`로 줘서 과거 기록의 판정이 바뀌지 않게 한다.
- 적용 방식:
  - 빈 볼륨: Compose가 `/docker-entrypoint-initdb.d`의 모든 파일을 이름순으로 자동 실행한다.
  - CI: 모든 파일을 이름순으로 `psql -v ON_ERROR_STOP=1 -f`로 적용한다.
  - **기존 DB: 컨테이너에 마운트된 파일을 직접 실행한다.**

    ```powershell
    docker compose exec -T db psql -U <db> -d <db> -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/NNN_<설명>.sql
    ```

    `Get-Content … | docker compose exec … psql`처럼 **PowerShell 파이프로 넘기지 않는다.** Windows PowerShell 5.1은 외부 프로그램으로 파이프할 때 ASCII로 보내 한글이 `?`로 깨진다. workout-memo에서 `'기타'` 브랜드가 `'??'`로 중복 저장되는 것을 재현했다. 어쩔 수 없이 파이프해야 하면 먼저 `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`를 설정한다.
- SQL의 한글 리터럴(CHECK 값 등)은 가능하면 `U&'\AC00\C2B4'` 같은 유니코드 이스케이프로 쓴다. 적용 경로와 무관하게 안전하다.
- 단위·NULL 규칙을 스키마에 명시한다. 확인하지 못한 값은 NULL로 두고 0과 구분한다. 수치 정밀도는 `NUMERIC(p,s)`로 정한다.
- 백업: `scripts/backup.ps1`이 `pg_dump --no-owner --no-acl`을 UTF-8(BOM 없음) 파일로 저장한다. `backups/`는 Git에서 제외하며, PC 밖 안전한 저장소에도 보관하고 주기적으로 복원을 확인한다.

## 7. 테스트와 CI

### 7.1 테스트 원칙

- 구현·수정과 같은 커밋에 테스트를 넣는다. 버그 수정에는 **수정 전 실패 → 수정 후 통과**를 확인한 회귀 테스트를 추가한다.
- 내부 구현을 그대로 반복하지 말고 사용자에게 보이는 결과와 도메인 규칙을 검증한다.
- 실패한 테스트를 skip·삭제하거나 판정을 약화해 통과시키지 않는다.

### 7.2 테스트 종류 [현재 적용]

| 종류     | 도구·방식                                                                                                                    | 파일 예                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 단위     | `node:test` + `assert/strict`, `tsx --test`                                                                                  | `backend/test/*.test.ts`   |
| DB 통합  | 실제 PostgreSQL. `TEST_DATABASE_URL`이 없으면 **건너뛴다**. 건너뛴 것은 통과로 세지 않는다                                   | `*.integration.test.ts`    |
| UI       | `vm.runInNewContext` + `ts.transpileModule`로 컴포넌트를 불러오고, 가짜 React·`fetch`·`localStorage`·시계로 렌더 결과를 검사 | `*-ui.test.ts`             |
| 브라우저 | 실제 dev 서버 + Playwright(MCP)로 모바일 390px·PC 1440px 확인. 자동 회귀 대체가 아니라 PR 전 수동 확인                       | 결과를 docs/changes에 기록 |

- DB 통합 테스트는 **사용자 DB가 아닌 전용 테스트 DB**에서만 돌린다. 병렬 작업이 서로 간섭하지 않도록 브랜치(이슈)별 DB나 테스트별 스키마를 쓴다.
- 날짜에 의존하는 테스트는 "오늘"을 주입하거나 가짜 `Date`로 고정한다.

### 7.3 통합 CI (`.github/workflows/ci.yml`)

```yaml
name: Verify application
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_USER: <db>, POSTGRES_PASSWORD: test, POSTGRES_DB: <db> }
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24.21.0', cache: npm }
      - run: npm install --global npm@11.19.0
      - run: npm ci
      - run: |
          for migration in database/migrations/*.sql; do
            psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" || exit 1
          done
        env: { TEST_DATABASE_URL: 'postgres://<db>:test@localhost:5432/<db>' }
      - run: npm run check
        env: { TEST_DATABASE_URL: 'postgres://<db>:test@localhost:5432/<db>' }

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t <app>-frontend:ci ./frontend
      - run: docker build -t <app>-backend:ci ./backend
```

CI 러너 안의 `npm ci`는 격리된 GitHub 환경에서 잠금 파일대로 설치하는 것이므로 로컬 설치 금지 규칙과 별개다. 하위 저장소용 CI는 다음과 같다.

- `frontend/.github/workflows/ci.yml`: `npm ci` → `npm run build` → `docker build`
- `backend/.github/workflows/ci.yml`: `npm ci` → `npm run build` → `npm test`(DB 없이 단위 테스트, 통합은 건너뜀) → `docker build`
- `infrastructure/.github/workflows/ci.yml`: `terraform init -backend=false && terraform validate`

## 8. 디자인 시스템

workout-memo는 차분한 그린 계열의 "운동 노트" 톤이다. 새 프로젝트도 다른 지시가 없으면 아래 토큰과 컴포넌트에서 시작한다. 새 프로젝트에서는 값을 처음부터 **CSS 변수(`:root`)로 정의**한다. workout-memo는 색을 직접 써서 나중에 공통화가 어려웠다.

### 8.1 토큰

| 토큰              | 값                                                      | 용도                                  |
| ----------------- | ------------------------------------------------------- | ------------------------------------- |
| 글꼴              | `'DM Sans', 'Noto Sans KR', sans-serif` (Google Fonts)  | 영문 DM Sans, 한글 Noto Sans KR       |
| 기본 글자 크기    | `14px`, `font-synthesis: none`                          |                                       |
| 본문 색           | `#25372f`                                               | 텍스트                                |
| 페이지 배경       | `#f7f8f5`                                               |                                       |
| 사이드바 배경     | `#fcfcfa`, 구분선 `#e5e8e1`                             |                                       |
| 주요 색(Primary)  | `#294432` 배경 / `#f3f7ec` 글자                         | 주요 버튼                             |
| 강조(포커스)      | `#a1bd56`                                               | `:focus-visible` 3px 외곽선, 3px 간격 |
| 카드              | 배경 `#fff`, 테두리 `#e3e7dd`, 반경 `9px`               |                                       |
| 모달              | 배경 `#fcfdf9`, 반경 `12px`, 그림자 `0 20px 80px #0003` |                                       |
| 보조 배경         | `#f4f6ef`, `#eaf0df`                                    | 탭·안내 상자                          |
| 흐린 글자         | `#9aa48f`                                               | 보조 설명                             |
| 경고 배경         | `#fff0e9`                                               | 오류                                  |
| 버튼 반경         | `6px`, 안쪽 여백 `12px 17px`, 글자 `12px/500`           |                                       |
| 테마 색(브라우저) | `<meta name="theme-color" content="#182b26">`           |                                       |

### 8.2 레이아웃과 컴포넌트

- **셸:** 왼쪽 고정 사이드바(`aside`, 너비 234px, 로고·내비게이션·프로필)와 오른쪽 콘텐츠. 상단에 브레드크럼("내 워크스페이스 › 화면")을 둔다.
- **페이지 헤더:** 작은 대문자 문구(eyebrow) + 큰 제목 + 설명 + 우측 주요 버튼.
- **기간 바:** 탭(1일·1주·1달·4주·12주) + 이전/다음 + 날짜 입력.
- **통계 카드(stat):** 라벨, 큰 숫자 + 단위, 아래 보조 설명.
- **카드·목록 행:** 날짜 타일, 제목, 요약, 우측 수치·수정·삭제.
- **버튼 3종:** `primary`(주요 동작), `subtle-button`(보조), `text-button`(약한 동작). 아이콘은 lucide-react를 쓰고, 아이콘만 있는 버튼은 반드시 `aria-label`을 단다.
- **모달 폼:** `form-grid` 2열, 라벨이 입력을 감싼다(`<label>텍스트<input/></label>`). 입력 안내는 `form-hint`.
- **상태 표시:** 저장 상태는 `role="status"`, 오류는 `role="alert"`, 토글은 `aria-pressed`, 비어 있을 때는 빈 상태 안내(제목 + 설명 + 행동 버튼).
- **차트:** 라이브러리 없이 SVG·CSS로 직접 그리고 `role="img"`와 값을 요약한 `aria-label`을 단다. 값이 없는 날을 0으로 잇지 않는다.

### 8.3 반응형·검증

- 중단점: `min-width: 1500px`(넓은 화면), `max-width: 1100px`(태블릿), `max-width: 760px`(모바일).
- 화면을 바꾼 PR은 **모바일 390×844와 PC 1440×900**에서 실제 브라우저로 확인한다. 가로 스크롤(`scrollWidth > innerWidth`)이 없는지 보고 결과를 docs/changes에 남긴다.
- 브라우저 확인에서 찾은 문제(이중 클릭 토글, 저장 후 화면 미갱신 등)는 회귀 테스트와 함께 고친다.

## 9. Git 전략

- **GitHub Flow:** `main`은 항상 배포 가능한 상태로 둔다. 모든 변경은 이슈에서 출발한다.
- **순서:** GitHub 이슈 등록 → 이슈 번호 브랜치 → 구현·테스트·`docs/changes` 기록을 같은 커밋에 → `npm run check` → PR → 자동 코드 리뷰(최대 2회) → CI 확인 → **CI 통과 후 에이전트 병합**.
- **이슈:** 목적, 범위, 완료 기준(체크박스), 검증 방법, 경계를 적는다. 정해야 할 규칙은 "구현 전 결정 사항"으로 남기고, 사용자가 정하면 이슈 코멘트로 확정 규칙을 기록한다. 본문은 UTF-8 파일로 만들어 `gh issue create --body-file`로 등록한다.
- **브랜치:** `<type>/<이슈번호>-<slug>`. type은 `feat`, `fix`, `docs`, `chore`(예: `feat/12-workout-editor`). 같은 이슈의 기존 브랜치가 있으면 이어서 쓴다.
- **커밋 제목:** `feat: <영문 요약> (#12)`. 본문에 이유를 쓴다. AI 공동 작성이면 `Co-Authored-By:` 줄을 넣는다.
- **PR:** 대상은 `main`이다. 본문에는 다음을 넣는다.
  - 요약, 주요 변경, 실제 검사 명령과 pass/fail/skip
  - 화면 변경의 확인 결과, 판단 사항·확인이 필요한 사항
  - `Closes #N`(부분 구현이면 `Refs #N`)

  검증이 남았으면 draft로 둔다. 같은 브랜치의 PR이 있으면 새로 만들지 않고 갱신한다.

- **리뷰:** PR을 올린 뒤 자동 코드 리뷰를 최대 2회 거친다. 리뷰에서 보완점이 나오면 추가 커밋으로 반영하고, 1차 보완 후에는 2차 리뷰를 한 번 더 받는다. 2차 보완 커밋 뒤에는 더 리뷰하지 않는다. 보완점이 없으면 바로 다음 단계로 간다. 이 PR에서 고치기에 큰 수정은 새 이슈카드로 분리한다. 각 차수 결과는 PR 코멘트와 `docs/changes` 기록에 남긴다.
- **병합:** 최종 head의 필수 CI가 모두 통과하면 에이전트가 merge commit(`--merge --match-head-commit <head SHA>`)으로 병합한다. 연속 PR은 순서대로 병합한다. 앞 PR 병합 후 나중 PR 브랜치에 `origin/main`을 병합해 충돌을 풀고, 양쪽 기능을 모두 살렸는지 테스트로 확인한 뒤 일반 푸시하고 CI 통과 후 병합한다. main 병합이 배포를 일으키도록 연결하면 병합 후 배포 결과도 확인한다.
- **병렬 작업:** 이슈마다 별도 `git worktree`를 쓴다. 공유 stash를 피하고, 마이그레이션 번호와 테스트 DB를 이슈별로 나눈다.

## 10. AI 지침 체계

### 10.1 파일 역할

| 파일                                                       | 역할                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                | 모든 에이전트 공통 지침. 작업 절차, 프로젝트 기준(포트·시간대·단위), 검증 명령, 금지 사항, 계정 규칙                     |
| `CLAUDE.md` [추천]                                         | Claude Code가 자동으로 읽는 파일. "이 프로젝트는 `AGENTS.md`를 따른다" + Claude 전용 차이만 짧게 쓴다                    |
| `skills/<app>-implementation/SKILL.md`                     | 이슈 → 브랜치 → 구현·docs → 테스트 → PR → 자동 리뷰(최대 2회) → CI 통과 후 병합 절차                                     |
| `skills/<app>-testing/SKILL.md`                            | 테스트 작성·실행·기록 기준                                                                                               |
| `skills/<app>-foundation/SKILL.md` + `references/stack.md` | 개발 기반·기술 추천·적용 순서                                                                                            |
| `.claude/skills/`                                          | `skills/`의 Claude Code용 복제본. 원본만 고치고 `npm run skills:sync`로 갱신하며, `npm run check`가 불일치를 실패로 처리 |

- 스킬 원본은 저장소 `skills/` 하나다. Codex는 Codex 홈의 `skills/`에 설치하고, Claude Code는 `.claude/skills/`를 읽는다.
- 스킬 파일은 YAML 머리말(`name`, `description`)을 갖춘다. 변경 후 skill-creator의 `quick_validate.py`로 검사한다(Windows에서는 `PYTHONUTF8=1`).
- 스킬 본문에는 저장소 경로 상대 링크를 쓰지 않는다. 복제 위치가 달라져도 링크가 깨지지 않게 하기 위해서다.

### 10.2 `AGENTS.md`에 넣을 항목 (템플릿)

```markdown
# <App 표시명> 프로젝트 지침

## 구현 작업 절차

기능·수정·리팩터링·설정·문서·스킬 변경 요청에는 skills/<app>-implementation/SKILL.md를 따른다.

1. <owner>/<app>에 이슈를 등록한다(사용자가 지정한 기존 이슈는 재사용).
2. `<type>/<이슈번호>-<slug>` 브랜치를 만든다.
3. 구현과 테스트를 함께 작성하고 각 커밋에 docs/changes/<이슈번호>-<slug>.md 기록을 포함한다.
4. 커밋 전과 PR 생성·갱신 전에 `npm run check`를 실행하고 결과를 docs와 PR에 기록한다.
5. **PR 후 자동 코드 리뷰를 최대 2회 거치고(큰 수정은 새 이슈카드로 분리), 필수 CI가 모두 통과하면 에이전트가 PR을 병합한다(`--merge --match-head-commit`).**
   질문 답변·추천·읽기 전용 조사는 이슈나 브랜치를 만들지 않는다.

## 프로젝트 기준

- 기술: React + Vite + TypeScript, Express + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions.
- 웹 포트 <web-port>, 호스트 DB 포트 <db-port>(127.0.0.1 바인딩). 사용자 요청 없이 바꾸지 않는다.
- 날짜 YYYY-MM-DD, 시간대 <timezone>. <도메인 단위·NULL 규칙>.
- 입력 검증·판정은 서버에서도 한다. 여러 행 변경은 트랜잭션.
- .env, 토큰, 실제 백업, Terraform state를 커밋·기록하지 않는다.
- 사용자 변경을 덮어쓰지 않고 필요한 파일만 stage한다.
- npm 패키지 설치·삭제는 사용자 재확인 후 --ignore-scripts 우선.
- 하위 저장소 동기화(scripts/push-repositories.ps1)와 AWS 배포는 별도 요청 시에만.

## 검증 명령

- 전체: `npm run check`. DB 통합: 전용 DB의 `TEST_DATABASE_URL` 설정 후 `npm test`(미설정 시 건너뜀 = 미검증).
- 인프라: `terraform validate`. 문서·스킬만 변경: 포맷·링크·스킬 검증기.

## 문서

- docs/changes(이슈별), docs/daily(작업일 총정리), docs/next-steps(최신 다음 작업).
```

### 10.3 계정 분리 (회사·개인 계정을 함께 쓰는 PC)

- 기본 `gh`는 그대로 두고, 프로젝트 전용 래퍼(`scripts/gh-project.ps1`)를 쓴다. 래퍼는 상속된 `GH_TOKEN`/`GITHUB_TOKEN`을 지우고 `gh auth token --user <owner>`로 받은 토큰을 그 호출에만 적용한다.
- Git push는 이 저장소의 **로컬** credential helper로 래퍼를 지정한다. 전역 helper는 바꾸지 않는다.
- 원격 작업 전에 `<래퍼> api user --jq .login`이 `<owner>`인지 확인한다. 다른 계정으로 우회하지 않는다.
- 래퍼는 git 저장소 안에서 실행한다. 저장소 밖에서 실행하면 실패한다.
- Codex 개인 프로필은 `CODEX_HOME` 환경변수로 고른다. 상세 구현은 workout-memo의 `docs/project-github-auth.md`를 참고한다.

### 10.4 [선택] 로컬 AI 워커

workout-memo는 확정한 이슈를 큐에 넣으면 PC에서 테스트 → 구현 → 독립 검토 → 검사 → PR을 자동으로 처리하는 워커(`scripts/agents.ps1`)를 운영한다. 새 프로젝트에 처음부터 필요하지는 않다. 도입할 때 지켜야 할 점은 다음과 같다.

- 역할별 모델을 고정한다(예: 계획·디버깅·고위험 검토는 상위 모델, 테스트·구현·검토는 표준 모델). 임의로 다른 모델로 바꾸지 않는다.
- 이슈별 worktree, 잠금, 상태 전이를 테스트한다(`npm run test:agents`).
- **샌드박스 안에서는 Vite/esbuild 빌드가 상위 폴더 읽기 권한 문제로 실패할 수 있다.** 최종 `npm run check`는 호스트에서 실행한다.
- 상세: workout-memo의 `docs/local-agent-workflow.md`.

## 11. 부트스트랩 체크리스트

각 단계 끝의 "확인"을 통과해야 다음 단계로 간다.

1. **값 확정:** 0장의 자리표시자를 사용자에게 받는다. 확인: 표가 모두 채워졌다.
2. **계정·원격:** 사용할 GitHub 계정을 확인하고, 필요하면 10.3의 래퍼를 준비한다. 확인: `api user --jq .login` = `<owner>`.
3. **런타임:** Node 24.21.0 / npm 11.19.0을 고른다(nvm·Volta 등 사용자 도구로. 시스템 Node를 임의로 바꾸지 않는다). 확인: `node -v`, `npm -v`.
4. **골격 파일:** 4.2 구조와 5장의 설정 파일, `.env.example`, `compose.yaml`, Dockerfile, nginx.conf, `database/migrations/001_initial.sql`(최소 테이블)을 만든다.
5. **의존성 설치(사용자 확인 필수):** 3.1의 패키지 목록을 보여주고 1장 1번 절차로 승인받은 뒤 설치한다. 확인: `package-lock.json`, 각 워크스페이스 잠금 파일이 생겼다.
6. **최소 기능:** `createApp(pool)`, `GET /api/health`, 기준 화면 1개, 단위 테스트 1개, DB 통합 테스트 1개, UI 테스트 1개를 만든다.
7. **로컬 검증:**
   - `docker compose up -d db`로 DB를 띄운다.
   - 전용 테스트 DB를 만들어 모든 마이그레이션을 `psql -f`로 적용한다.
   - `TEST_DATABASE_URL`을 설정하고 `npm run check`를 실행한다.

   확인: exit 0이고 DB 테스트가 건너뛰지 않았다.

8. **컨테이너 실행:** `.env`를 만들고 `docker compose up --build -d`를 실행한다. 확인: `http://localhost:<web-port>` 화면과 `/api/health` 응답이 정상이다.
9. **AI 지침:** 10장의 `AGENTS.md`, `CLAUDE.md`, 스킬 3종, `.claude/skills` 동기화 스크립트와 테스트를 만든다. 확인: `npm run check`에 `test:skills`가 포함되고 통과한다.
10. **문서:** README(실행·검증·저장소 구성), `docs/development-baseline.md`, `docs/changes/`, `docs/daily/`, `docs/next-steps/`를 만든다.
11. **저장소 생성:** 사용자 승인 후 `scripts/create-repositories.ps1 -Owner <owner>`로 우산 저장소와 하위 저장소 4개를 비공개로 만든다. 확인: 각 저장소 CI가 통과한다.
12. **인프라 초안:** `infrastructure/`에 12장의 Terraform을 두고 `terraform init -backend=false && terraform validate`를 실행한다. 실제 `apply`는 사용자가 배포를 요청했을 때만 한다.
13. **첫 이슈부터 GitHub Flow:** 이후 모든 변경은 9장 절차로 진행한다.

## 12. AWS 인프라

### 12.1 [현재 적용] 공유 Terraform 초안 (`infrastructure/`)

- 리전 `<region>`(기본 `ap-northeast-2`), `project` 변수(기본 `shared-apps`)로 여러 앱이 공유한다.
- **ECR:** 앱별 frontend·backend 저장소(`for_each`), 태그 변경 불가(IMMUTABLE), 푸시 시 이미지 검사, AES256 암호화, 최근 10개만 보관하는 수명 주기 정책.
- **AWS Budgets:** 월 `<budget-usd>` USD, 실제 지출 80% 초과 시 이메일. 예산 알림은 **지출을 막지 않는다.**
- 실행: `terraform init` → `terraform plan -var='budget_email=…'` → `terraform apply …`. **state 파일은 Git에 넣지 않는다**(민감정보 포함 가능).
- 다른 앱을 추가하려면 ECR `for_each` 목록에 이름을 더한다.

```hcl
terraform {
  required_version = ">= 1.6.0"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
provider "aws" { region = var.region }
```

### 12.2 배포 대안 (아직 미연결, 비용은 2026-10-15 서울 리전 공식 요금 기준 추정)

| 대안                          | 구성                                                     | 월 비용 감(세전)                                | 비고                                                    |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| 1. 공유 서버(개인 앱 여러 개) | Lightsail 1대에 Docker Compose + PostgreSQL, ECR, 스냅샷 | 2 GB: 약 $13.50 / 4 GB: 약 $25.50(서버 전체)    | 0.5~1 GB는 여유 부족. 앱별 DB 또는 스키마와 권한을 분리 |
| 2. 앱 서버 + 관리형 DB        | EC2/Lightsail + RDS PostgreSQL                           | 사용자 초기 예산 3만~6만원 이상(확정 견적 아님) | 백업·유지관리 부담 감소                                 |
| 3. 관리형 확장                | ECS Fargate + ECR + RDS + ALB                            | 상시 비용 큼                                    | 트래픽·가용성이 필요할 때                               |
| 정적 프런트만                 | Amplify 등                                               | 별도 계산                                       | API·DB는 따로 필요                                      |

- **로그인 없는 앱은 공개 인터넷에 그대로 노출하지 않는다.** VPN·사설 접속 또는 인증을 먼저 설계한다.
- 배포할 때 함께 준비할 것: HTTPS, 원격 state(S3 + 잠금), GitHub OIDC 배포 역할(장기 키 없음), 이미지 버전 태그, health check, CloudWatch 로그 보존 기간, 백업·복원 절차, 이전 이미지로 되돌리는 방법.
- 상세 비용 계산: workout-memo의 `docs/shared-hosting-costs.md`.

## 13. 이 프로젝트에서 확인된 함정

| 증상                                                       | 원인                                                      | 대응                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 한글이 DB에 `?`로 저장되고 재적용 시 중복 행 생성          | PowerShell 5.1 파이프가 ASCII로 전송                      | `psql -f`로 마운트 파일 실행, 또는 `$OutputEncoding`을 UTF-8로 설정, SQL은 `U&` 이스케이프 |
| AI 샌드박스에서 `npm run check`의 빌드만 실패              | Vite/esbuild가 상위 폴더(공유 `node_modules`)를 읽지 못함 | 최종 검사는 호스트에서 실행하고 결과를 기록                                                |
| Prettier 검사가 갑자기 실패                                | `.bkit/`, `.playwright-mcp/` 같은 도구 산출물             | `.gitignore`·`.prettierignore`에 추가                                                      |
| 병렬 PR이 같은 마이그레이션 번호를 사용                    | 브랜치별로 각자 다음 번호를 고름                          | 착수 시 번호 예약                                                                          |
| 여러 PR이 같은 큰 파일(`main.tsx`·`app.ts`)에서 계속 충돌  | 화면·라우트가 한 파일에 모여 있음                         | 기능별 모듈로 분리, 나중 PR에서 `main` 병합 후 양쪽 기능을 테스트로 확인                   |
| 토글 버튼 더블클릭이 상태를 되돌림                         | 두 클릭이 서로 다른 렌더에서 처리됨                       | 짧은 시간 안의 반대 동작 무시 + 회귀 테스트                                                |
| 다른 화면에서 저장한 데이터가 돌아와도 안 보임             | 화면 진입 시 다시 불러오지 않음                           | 화면 전환 시 재조회                                                                        |
| 서버 검증 오류가 영어 원문으로 노출                        | Zod 기본 메시지                                           | 사용자에게 보이는 검증에 한국어 메시지 지정                                                |
| 백업 "전체 교체" 후 재시도가 삭제된 id를 "저장됨"으로 응답 | 멱등 재시도 키가 남아 있음                                | 교체 복원 시 재시도 키도 같은 트랜잭션에서 초기화                                          |
| DB 테스트가 "통과"로 보였지만 실제로는 실행 안 됨          | `TEST_DATABASE_URL` 미설정 시 건너뜀                      | skip 수를 확인하고 미실행을 별도로 보고                                                    |

## 14. 참고할 원본 파일 (workout-memo)

설정을 그대로 가져올 때는 아래 파일을 원본으로 대조한다.

- 지침: `AGENTS.md`, `skills/workout-implementation/SKILL.md`, `skills/workout-testing/SKILL.md`, `skills/workout-foundation/SKILL.md`, `skills/workout-foundation/references/stack.md`
- 설정: `package.json`, `.npmrc`, `.editorconfig`, `.gitattributes`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, `frontend/tsconfig.json`, `backend/tsconfig*.json`, `frontend/vite.config.ts`
- 실행: `compose.yaml`, `.env.example`, `frontend/Dockerfile`, `frontend/nginx.conf`, `backend/Dockerfile`
- CI: `.github/workflows/ci.yml`, `frontend|backend|infrastructure/.github/workflows/ci.yml`
- 저장소: `scripts/create-repositories.ps1`, `scripts/push-repositories.ps1`, `scripts/backup.ps1`, `scripts/claude-skills.mjs`
- 인프라: `infrastructure/main.tf`, `infrastructure/versions.tf`, `infrastructure/README.md`
- 문서: `docs/development-baseline.md`, `docs/project-github-auth.md`, `docs/local-agent-workflow.md`, `docs/shared-hosting-costs.md`, `docs/agent-issue-template.md`
