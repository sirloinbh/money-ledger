<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/에서 -->
# Claude Code 지침

이 프로젝트는 [AGENTS.md](AGENTS.md)와 [AGENTS.project.md](AGENTS.project.md)를 따른다. 작업 절차·금지 사항·검증 명령은 두 파일이 원본이고, 둘이 다르면 AGENTS.project.md가 우선한다.

- 스킬은 `.claude/skills/`에 있으며 원본 `skills/`의 복제본이다. 직접 고치지 말고 원본을 고친 뒤 `npm run skills:sync`를 실행한다. `std-`로 시작하는 공통 스킬은 중앙 리포 `sirloinbh/project-standards`에서 고친다.
- 커밋 메시지와 PR 본문의 공동 작성자 표기는 실행 환경의 안내를 따른다.
