# #34 가계부·포트폴리오·모의투자 메뉴와 빈 화면

- 이슈: [#34](https://github.com/sirloinbh/money-ledger/issues/34)
- 브랜치: `feat/34-area-navigation`

## 목적

세 영역의 화면 주소와 메뉴를 먼저 정해, 이후 기능 이슈들이 같은 파일에서 충돌하지 않게 한다.

## 변경 — 2026-11-02

- `frontend/src/app.tsx`: `/ledger`, `/portfolio`, `/mock-trading` 주소와 메뉴를 추가했다. 앱 표시 이름을 `가계부·자산·모의투자`로 바꾸고 대시보드 설명에 모의투자를 넣었다.
- `frontend/src/ledger.tsx`, `portfolio.tsx`, `mock-trading.tsx`: 영역별 빈 상태 화면을 추가했다.
- `frontend/src/page.tsx`: 화면 공통 틀을 `app.tsx`에서 옮겼다.
- `frontend/index.html`: 브라우저 탭 제목을 앱 표시 이름에 맞췄다.
- `README.md`: 서비스 소개에 모의투자를 넣었다.

## 판단

- 이슈에는 "기능 코드를 둘 폴더"로 적었지만 폴더 대신 화면별 파일로 만들었다. 중앙 `docs/directory-rules.md`가 `frontend/src/<기능>.tsx`를 표준으로 정하기 때문이다.

## 검증

- `frontend/src/app.test.tsx`에 7개를 추가했다.
  - 메뉴를 눌러 세 화면으로 이동하고 현재 메뉴가 표시된다(3개).
  - 세 주소를 직접 열어도 같은 화면이 보인다(3개).
  - 영역 화면에서 서버 오류가 경고로 표시된다(1개).
- `npm run check`: 통과. 백엔드 6개 중 5개 통과, 1개 건너뜀. 프론트엔드 67개 중 65개 통과, 2개 건너뜀. 스킬 테스트 4개 통과.
- 건너뛴 백엔드 테스트는 DB 통합 테스트다. 이 PC의 `TEST_DATABASE_URL`이 다른 앱의 DB를 가리켜([#32](32-dev-env-followups.md)) 비우고 실행했다. PR CI로 확인한다.
- `npm run standards:check`, `npm run knip`: 통과.
- 브라우저: headless Chrome으로 Vite 개발 서버를 열어 모바일 390×844와 PC 1440×900을 확인했다.
  - 대시보드와 세 영역의 주소를 직접 열면 제목, 현재 메뉴, 빈 상태 안내가 맞게 표시된다.
  - 양쪽 크기 모두 메뉴 링크로 모의투자 화면에 이동한다. 모바일은 메뉴 시트를 열어 확인했다.
  - 가로 스크롤이 없다(모바일 `scrollWidth` 390, PC 1425와 세로 스크롤 막대 15).

## 한계

- Docker와 `.env`가 없어 API 없이 확인했다. 그래서 브라우저에서는 정상 상태 문구 대신 `서버에 연결할 수 없습니다` 경고가 보였다. 정상 문구는 단위 테스트로 확인했다.
- Claude in Chrome 확장이 연결되지 않아 headless Chrome을 썼다.
- `frontend/public/manifest.webmanifest`와 `AGENTS.md`의 앱 이름과 소개는 중앙 레지스트리 값이라 바꾸지 않았다. 설치형 앱 이름에는 아직 모의투자가 없다.
