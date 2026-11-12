<!-- Managed file. Edit it in sirloinbh/project-standards templates/app/ -->
# Money Ledger Project Instructions

A personal service for recording income, spending, and an asset portfolio to see the flow of money, and for practicing investment decisions with mock trading. There is one user (me) and no login. Before any public exposure, design private access or authentication first.

This file holds the instructions shared by all apps. **Always read and follow [AGENTS.project.md](AGENTS.project.md) as well**; it has the rules that apply only to this project (domain rules, extra verification commands, project-specific skills). If the two files differ, AGENTS.project.md wins.

## Implementation procedure

For requests to add, change, or refactor features, or to change settings, docs, or skills, read and apply [std-implementation](skills/std-implementation/SKILL.md). To split requirements into issues and choose the next task, follow [std-backlog](skills/std-backlog/SKILL.md). To write issues, branches, commits, and PRs, follow [std-git-writing](skills/std-git-writing/SKILL.md). Write explanations to the user in English, as [std-communication](skills/std-communication/SKILL.md) says. Keep progress, decisions, and next steps in md files (`docs/daily/`, `docs/changes/`), not in the chat or memory, as [std-session-notes](skills/std-session-notes/SKILL.md) says; at the start of a session, read the latest `docs/daily/` file first.

1. Register an issue in `sirloinbh/money-ledger`. If the user named an existing issue, reuse it.
2. Create a work branch that contains the issue number: `<type>/<issue-number>-<slug>`.
3. Write the implementation or fix together with the relevant tests, and include a `docs/changes/<issue-number>-<slug>.md` change record in each commit.
4. Run `npm run check` before committing and before creating or updating a PR. Record the results in the docs and the PR.
5. Follow [AGENTS.project.md](AGENTS.project.md) for PR review and merge rules. If it does not set them, **only the user merges PRs.** Merging to main is a production deploy. Outside the rules set there, the agent must not merge, enable auto-merge, or approve in place of a merge. PRs opened by an agent worker (project-standards `tools/agents`) follow `autoMerge` in this repo's `.agents.json` (auto-merge if the file is missing; per-repo values are in project-standards `docs/tools.md`).

Answering questions, giving recommendations, and read-only investigation do not create an issue or a branch. For rules the requirements do not set (aggregation method, policy, scope), confirm with the user along with a recommendation, and record the answer in an issue comment.

## Project baseline

- Tech: React + Vite + TypeScript, Express + pg + Zod, PostgreSQL 17, npm workspaces, Docker Compose, GitHub Actions. Node 24.21.0 / npm 11.19.0.
- Ports (bound to 127.0.0.1): web 8105, API 3105, Vite 5205, host DB 15405, e2e API 3205, e2e web 5305. The ports come from the central registry (`registry/projects.json` in `sirloinbh/project-standards`). To change them, open an issue in the central repo.
- DB name: `money`, test DB: `money_test`.
- Dates use `YYYY-MM-DD`, and the service time zone is `Asia/Seoul`.
- Do not commit `.env`, auth tokens, real backups, or Terraform state, and do not record them in docs, PRs, or logs.
- Do not overwrite user changes. Stage only the files you need, by name.
- **Install or remove npm packages only after the user reconfirms, and prefer `--ignore-scripts`.** `npm ci` (installs from the lockfile), `npm run <script>`, `npm ls`, and `npm view` are allowed.
- Do GitHub remote work with the `scripts/gh-project.ps1` wrapper for the personal account `sirloinbh`. Do not make remote changes with the default work account `gh`.
- The `frontend`, `backend`, and `database` sub-repositories are subtree targets for deployment. During everyday PR work, do not push directly to a sub-repository or to `main`. Use `scripts/push-repositories.ps1` only for a separate sync request. AWS infrastructure is managed in the shared repo `sirloinbh/shared-aws-infrastructure`.

## Centrally managed files

- Files whose first line says "Managed file" (older files: "중앙 관리 파일") and files listed in `.standards/manifest.json` are managed by `sirloinbh/project-standards`. If you edit them directly in this repo, the CI `standards-check` fails. Raise the change in the central repo with an issue and a PR.
- In files that have a `# --- project ---` line, such as `.gitignore` and `.prettierignore`, this project may edit only below that line.

## Skills and docs

- Shared skills (centrally managed): [std-implementation](skills/std-implementation/SKILL.md), [std-testing](skills/std-testing/SKILL.md), [std-foundation](skills/std-foundation/SKILL.md), [std-backlog](skills/std-backlog/SKILL.md), [std-git-writing](skills/std-git-writing/SKILL.md), [std-communication](skills/std-communication/SKILL.md), [std-session-notes](skills/std-session-notes/SKILL.md), [std-ux-audit](skills/std-ux-audit/SKILL.md) (UX and accessibility audits).
- Project-specific skills are the folders under `skills/` whose names do not start with `std-`; they are listed in [AGENTS.project.md](AGENTS.project.md).
- Path-specific rules are in `.claude/rules/`: `database.md` (migrations, DB tests), `backend.md` (server validation, transactions), `frontend.md` (browser check sizes), `docs-and-skills.md` (skill copies, docs checks). Claude Code loads each one when it works on matching files; other agents read the matching file before changing those paths.
- Work records: `docs/changes/`. Daily summaries: `docs/daily/YYYY-MM-DD.md` (the list is in `docs/daily/README.md`). Latest next steps: `docs/next-steps/README.md`.

## Verification commands

- Everything: `npm run check`.
- Do not mark the command of a tool that is not installed yet as runnable.
