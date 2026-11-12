---
name: std-foundation
description: Establish or improve the repeatable development foundation of a sirloinbh app, covering stack, structure, conventions, API contracts, design, tests, AI guidance, and deployment. Use for project foundation requests; apply only the requested scope through the std-implementation issue-to-PR workflow.
---

<!-- Managed file. Edit it in sirloinbh/project-standards templates/app/skills/std-foundation/ -->

# Money Ledger Development Foundation

Organize how this app is developed, verified, and operated so it can be repeated. First read `AGENTS.md` and `AGENTS.project.md` at the project root and [std-implementation](../std-implementation/SKILL.md), then work through the steps: issue → numbered branch → implementation and docs record → tests and PR. This skill does not skip the issue and PR procedure, and it does not grant deploy or merge authority.

## Standards

- The central repo `sirloinbh/project-standards` sets the shared standards (stack allow-list, versions, directory rules, design tokens). If a shared standard must change, open an issue in the central repo, not in this repo.
- Check the current package.json, lockfile, API and SQL, Compose, and CI, and tell what is actually implemented apart from what is only recommended (not adopted). Do not install the whole recommended list automatically.
- The user is one person, and login is not in the current requirements. Dates use the Asia/Seoul time zone. The project's own domain rules are in `AGENTS.project.md`.
- When you change or add a tool, first write down the real problem, the data impact, and how you will verify it. Install packages only after the user reconfirms.

## Steps

1. Set the current state and the issue's completion criteria, and record the reasons for choices, the structure, and the contracts in the docs.
2. Keep tool settings, run commands, CI, and docs in line in the same change. Do not create unused settings, scripts, or empty modules.
3. For API and DB changes, preserve existing data and the meaning of dates and units, and verify how migrations are applied and how to recover from a failure. Pick a single source for DB migrations.
4. For screen changes, use the shared design tokens and shared components, and handle loading, empty results, errors, and keyboard access within the scope.
5. Apply [std-testing](../std-testing/SKILL.md) as well. Write the implementation and tests together, add a regression test for each bug, and record the actual results in the docs and the PR.
6. Deploy only within the scope the user requested. Prepare image versions, health checks, secret management, backup and restore, and rollback to the previous version. Choose resources that cost money to fit the purpose and the budget.
7. Include a docs record in each work commit and open a verified PR. Follow the rules in `AGENTS.md` for merging.

## Completion criteria

Someone must be able to reproduce install, run, and verification from the docs in a fresh environment, and the tools you chose must be reflected in the actual code, commands, and CI. Write tools you did not install, checks you skipped, and deployments you did not actually do as follow-up work.
