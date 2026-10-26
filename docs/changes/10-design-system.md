# #10 공통 디자인 시스템으로 화면 전환

- 이슈: [#10](https://github.com/sirloinbh/money-ledger/issues/10) (중앙 추적 이슈 sirloinbh/project-standards#126)
- 브랜치: `feat/10-design-system`

## 목적

8개 앱이 같은 토큰·컴포넌트·레이아웃·PWA 설정을 쓰기로 했다(중앙 ADR-0007, ADR-0008). 방법은 중앙 `docs/design-system.md` "기존 앱 전환"을 따랐다(workout-memo#160이 먼저 적용).

## 변경 — 2026-10-26

### 패키지

사용자가 직접 설치했다. 중앙 ADR-0007 표의 패키지(2026-10-22 사전 승인)와 react-router·vitest·jsdom·Testing Library(2026-10-26 승인)다. 모두 고정 버전, 게시 14일 경과, `--ignore-scripts`.

- dependencies: `@sirloinbh/design-tokens` 1.0.0, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `radix-ui` 1.7.0, `react-router` 8.4.0, `sonner` 2.0.8, `tailwind-merge` 3.7.0, `tw-animate-css` 1.4.0, `vaul` 1.1.2, `lucide-react` 0.468.0 → 1.52.0
- devDependencies: `tailwindcss`·`@tailwindcss/vite` 4.3.3, `vitest` 5.0.3, `jsdom` 30.1.2, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/jest-dom` 7.0.1
- lockfile 두 개(루트, `frontend/`): 지워진 패키지 없음, 버전이 바뀐 것은 `lucide-react`뿐. 새 항목은 모두 공식 레지스트리·무결성 값 있음·설치 스크립트 없음. `ioc-scan`: 의심 항목 없음

### 공통 파일 (중앙 관리)

중앙에서 이 앱의 `features.ui`·`features.vitest`를 켠 동기화 미리보기에서 뽑은 그대로다: `frontend/src/components/ui/` 15개와 테스트, `components/layout/`, `lib/utils.ts`·`theme.ts`, `public/theme-init.js`, `frontend/vitest.config.ts`.

### 앱 코드

- **화면:** 자체 셸(사이드바·헤더)을 `AppShell`로 바꾸고 페이지 주소를 붙였다(`/`, `/settings`). 자체 `style.css`는 지우고 공통 토큰과 `EmptyState`를 쓴다.
- **진입점:** `app.tsx`(화면), `main.tsx`(렌더링과 운영 빌드에서만 서비스 워커 등록), `index.css`(Tailwind, `tw-animate-css`, 공통 토큰).
- **PWA:** 아이콘 4개(중앙 `scripts/pwa-icons.mjs`), `index.html`의 manifest·아이콘·라이트/다크 `theme-color`·`viewport-fit=cover`·깜빡임 방지 스크립트.
- **테스트·빌드:** `frontend`에 `test`(vitest) 스크립트와 `src/test/setup.ts`를 넣고, 루트 `npm test`가 프론트엔드 테스트도 돌린다. 운영 빌드는 `tsconfig.build.json`으로 테스트 파일을 뺀다. `vite.config.ts`에 Tailwind 플러그인.
- **백엔드의 화면 테스트 삭제:** `backend/test/app-ui.test.ts`는 Vitest가 없을 때 가짜 React로 `main.tsx`를 실행해 보던 임시 테스트다. 같은 내용(제목·서버 상태·오류 알림·메뉴 이동)을 프론트엔드 Vitest 테스트가 실제 React로 검사하므로 지웠다.
- **화면 테스트(`app.test.tsx`):** 서버 날짜 표시, 서버 오류 알림, 메뉴로 페이지 이동과 현재 페이지 표시, 알 수 없는 주소 처리.

## 검증

- Prettier, ESLint, `tsc`(전체), 프론트엔드 테스트 40개 통과, `vite build`, `ioc-scan`
- 백엔드 테스트는 DB가 필요해 CI에서 확인한다.
