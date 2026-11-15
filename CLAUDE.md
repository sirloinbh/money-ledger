<!-- Managed file. Edit it in sirloinbh/project-standards templates/app/ -->
# Claude Code instructions

This project follows the AGENTS.md and AGENTS.project.md imported below. They are the source of the work procedure, prohibited actions, and verification commands. When they differ, AGENTS.project.md wins.

@AGENTS.md
@AGENTS.project.md

- Skills in `.claude/skills/` are copies of the source `skills/`. Do not edit them directly; edit the source and run `npm run skills:sync`. Shared skills whose names start with `std-` are edited in the central repo `sirloinbh/project-standards`.
- Co-author lines in commit messages and PR bodies follow the runtime environment's instructions.
