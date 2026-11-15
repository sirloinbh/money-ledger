---
paths:
  - "docs/**"
  - "skills/**"
  - ".claude/skills/**"
---

<!-- Managed file. Edit it in sirloinbh/project-standards templates/app/.claude/rules/ -->

# Docs and skills

- The skill source is `skills/`. `.claude/skills/` is the Claude Code copy: do not edit it; run `npm run skills:sync`. Shared `std-*` skills are edited only in `sirloinbh/project-standards`.
- For a docs- or skills-only change, run the format and link checks and skill-creator `quick_validate.py` (on Windows with `PYTHONUTF8=1`).
