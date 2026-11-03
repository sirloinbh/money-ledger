# 가계부·자산·모의투자 고유 지침

이 파일은 money-ledger에만 해당하는 규칙이다. 공통 지침은 [AGENTS.md](AGENTS.md)이며, 중앙 표준(`sirloinbh/project-standards`) 동기화 후에는 중앙 관리 파일이 된다. 두 파일이 다르면 이 파일이 우선한다.

## 작업 절차 (공통 절차에 더해)

- **PR을 올린 뒤 자동 코드 리뷰를 최대 2회 거치고, 최종 head의 필수 CI 검사가 모두 통과하면 에이전트(주 에이전트·로컬 워커)가 확인 없이 병합한다.** 리뷰에서 보완점이 나오면 추가 커밋으로 반영하고, 1차 보완 후에는 2차 리뷰를 한 번 더 받는다. 2차 보완 커밋 뒤에는 더 리뷰하지 않는다. 보완점이 없으면 바로 다음 단계로 간다. 이 PR에서 고치기에 큰 수정은 새 이슈카드로 분리한다. 상세 절차는 implementation 스킬을 따른다. 병합은 프로젝트 래퍼로 `pr merge <url> --merge --match-head-commit <검증한 head SHA>`(merge commit)를 실행하고 연결 이슈(`Closes #N`)가 닫혔는지 확인한다. 연속 PR은 순서대로 병합한다. 앞 PR 병합 후 다음 PR 브랜치에 `origin/main`을 병합해 충돌을 풀고, 관련 테스트를 다시 실행하고, 일반 푸시 후 CI 통과를 기다려 병합한다. 실패·실행 중 검사가 있는 PR 병합, `--admin` 등 브랜치 보호 우회, 자기 PR 승인으로 검토 대체, `main` 직접 커밋·푸시, 강제 푸시는 하지 않는다. 현재 `main` 병합은 배포를 일으키지 않는다(배포 미연결).

## 고유 스킬

- [money-ledger-implementation](skills/money-ledger-implementation/SKILL.md), [money-ledger-testing](skills/money-ledger-testing/SKILL.md), [money-ledger-foundation](skills/money-ledger-foundation/SKILL.md): 이 프로젝트의 리뷰·병합 절차가 들어 있어 공통 스킬(std-*)이 들어온 뒤에도 유지한다.

## 서비스 규칙

### 카테고리 (#37)

- 카테고리는 지우지 않고 숨긴다. 숨긴 카테고리는 새 내역 입력 목록(`GET /api/categories` 기본값)에 나오지 않는다.
- 만든 뒤에는 종류(수입·지출)를 바꿀 수 없다. 이미 기록한 내역의 의미가 달라지기 때문이다.
- 이름은 앞뒤 공백을 지우고 1~30자이며, 같은 종류 안에서 겹칠 수 없다. 수입과 지출에는 같은 이름을 쓸 수 있다.
- 기본 카테고리는 테이블이 비어 있을 때만 넣는다. 마이그레이션을 다시 실행해도 사용자가 바꾼 이름은 되돌아오지 않는다.
