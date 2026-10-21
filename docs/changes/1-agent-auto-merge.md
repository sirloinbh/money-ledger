# 에이전트가 CI 통과 후 PR을 병합하도록 정책 변경 (#1)

- 이슈: [#1](https://github.com/sirloinbh/money-ledger/issues/1)
- 일자: 2026-10-21 (Asia/Seoul)

## 목적

저장소 소유자가 2026-10-21에 에이전트가 PR을 병합하도록 정책 변경을 명시적으로 지시했다. 프로젝트마다 병합을 반복 요청하지 않도록 "PR 병합은 사용자만 수행한다" 규칙을 CI 통과 후 에이전트 병합 규칙으로 바꾼다.

## 변경

- `AGENTS.md`, `README.md`, `docs/project-setup.md`(공통 규칙·Git 전략·지침 표·AGENTS 템플릿), `skills/money-ledger-{foundation,implementation,testing}/SKILL.md`(implementation 머리말 description 포함)의 병합 정책 문구를 바꿨다. `.claude/skills/`는 `npm run skills:sync`로 갱신했다.
- 새 정책: 필수 CI가 모두 통과하면 에이전트(주 에이전트·로컬 워커)가 확인 없이 `pr merge <url> --merge --match-head-commit <검증한 head SHA>`(merge commit)로 병합하고 연결 이슈가 닫혔는지 확인한다. 연속 PR은 순서대로 병합하며, 앞 PR 병합 후 다음 브랜치에 `origin/main`을 병합해 충돌을 풀고 테스트 재실행·일반 푸시·CI 통과 후 병합한다.
- 계속 금지: 실패·실행 중 검사가 있는 PR 병합, `--admin` 등 브랜치 보호 우회, 자기 PR 승인으로 검토 대체, `main` 직접 커밋·푸시, 강제 푸시.
- 이 프로젝트는 `main` 병합이 배포를 일으키지 않는다(배포 미연결). 연결 시 병합 후 배포 결과 확인을 추가하도록 적었다.
- 과거 기록(`docs/changes/bootstrap.md`)은 바꾸지 않았다. 병합 정책을 강제하는 스크립트·테스트는 없었다.

## 검증

- `npm run skills:sync`: 복제본 갱신.
- `npm run skills:check`: `.claude/skills matches skills/.`
- `node --test scripts/test/claude-skills.test.mjs`: **4 pass / 0 fail / 0 skip**.
- `PYTHONUTF8=1 python quick_validate.py skills/<각 스킬>`: 3개 모두 `Skill is valid!`.
- 사용자 전용 병합 문구 grep(과거 기록 제외): 남은 항목 없음.
- 로컬 `npm run check`는 실행하지 않았다. `node_modules`가 없고 이 프로젝트는 `npm ci`도 사용자 재확인 대상이라 설치하지 않았다. 포맷·lint·타입·테스트·빌드는 CI의 `npm run check`로 확인한다. 문서·스킬만 바뀌어 앱 테스트는 추가하지 않았다.
