---
name: money-ledger-foundation
description: Establish or improve the repeatable development foundation of the money-ledger app, covering stack, structure, conventions, API contracts, design, tests, AI guidance, and deployment. Use for project foundation requests; apply only the requested scope through the money-ledger-implementation issue-to-PR workflow.
---

# Household ledger, assets, and mock investing: development foundation

This skill makes the app's development, verification, and operation repeatable. First read `AGENTS.md` at the project root and `skills/money-ledger-implementation/SKILL.md`, then follow the flow: issue → numbered branch → implementation and docs record → tests and PR → automatic code review (at most 2 rounds) → merge after CI passes. This skill does not skip the issue and PR procedure and does not grant deployment permission.

## Baseline

- The baseline document is `docs/project-setup.md`. Check the current package.json, lockfiles, API and SQL, Compose, and CI so you can tell what is actually implemented from what is only recommended (not adopted). Do not install the whole recommended list automatically.
- The user is a single person and login is not a current requirement. Dates use Asia/Seoul.
- When you change or add a tool, first write down the real problem, the data impact, and the verification method. Install packages only after the user reconfirms.

## Steps

1. Decide the current state and the issue's done criteria, and record the reason for each choice, the structure, and the contracts in the docs.
2. Keep tool settings, run commands, CI, and docs consistent in the same change. Do not create unused settings, scripts, or empty modules.
3. For API and DB changes, preserve existing data and the meaning of dates and units, and verify how migrations are applied and how a failure is recovered. Pick a single source for the DB migrations.
4. For screen changes, keep the design tokens (the CSS variables in `frontend/src/style.css`) and the existing components, and cover loading, empty results, errors, and keyboard access within the scope of the change.
5. Apply `skills/money-ledger-testing/SKILL.md` together with this skill. Write the implementation and its tests together, add a regression test for every bug, and record the actual results in the docs and the PR.
6. Deploy only within the scope the user requested. Prepare image versions, health checks, secret management, backup and restore, and rollback to the previous version.
7. Include a docs record in each work commit and open a verified PR. Follow the money-ledger-implementation procedure: go through automatic code review at most 2 times (split a large fix into a new issue card), and merge once the required CI passes.

## Done criteria

A new environment must be able to reproduce install, run, and verification as the docs describe, and the chosen tools must show up in the real code, commands, and CI. Name tools that are not installed, checks that were skipped, and deployments that were not actually done as follow-up work.
