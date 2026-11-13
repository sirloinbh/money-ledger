# Change the policy so the agent merges PRs after CI passes (#1)

- Issue: [#1](https://github.com/sirloinbh/money-ledger/issues/1)
- Date: 2026-10-21 (Asia/Seoul)

## Purpose

On 2026-10-21 the repository owner explicitly instructed a policy change so that the agent merges PRs. So that merging does not have to be requested again for each project, the rule "only the user merges PRs" is replaced with a rule that the agent merges after CI passes.

## Changes

- Changed the merge policy wording in `AGENTS.md`, `README.md`, `docs/project-setup.md` (shared rules, Git strategy, the instructions table, and the AGENTS template), and `skills/money-ledger-{foundation,implementation,testing}/SKILL.md` (including the implementation front matter description). Refreshed `.claude/skills/` with `npm run skills:sync`.
- New policy: when all required CI checks pass, the agent (the main agent or a local worker) merges without asking, with `pr merge <url> --merge --match-head-commit <verified head SHA>` (merge commit), and checks that the linked issue is closed. Stacked PRs are merged in order; after the earlier PR is merged, `origin/main` is merged into the next branch to resolve conflicts, then merge after rerunning tests, a normal push, and CI passing.
- Still prohibited: merging a PR that has failing or running checks, bypassing branch protection with `--admin` or similar, replacing a review by approving your own PR, committing or pushing directly to `main`, and force-pushing.
- In this project a `main` merge does not trigger a deployment (deployment is not connected). We wrote that a check of the post-merge deployment result is to be added once it is connected.
- Past records (`docs/changes/bootstrap.md`) were not changed. No script or test enforced the merge policy.

## Verification

- `npm run skills:sync`: copies refreshed.
- `npm run skills:check`: `.claude/skills matches skills/.`
- `node --test scripts/test/claude-skills.test.mjs`: **4 pass / 0 fail / 0 skip**.
- `PYTHONUTF8=1 python quick_validate.py skills/<each skill>`: all 3 `Skill is valid!`.
- grep for user-only merge wording (excluding past records): nothing left.
- We did not run the local `npm run check`. There was no `node_modules`, and in this project even `npm ci` needs the user's reconfirmation, so we did not install. Format, lint, types, tests, and build are checked by CI's `npm run check`. Only docs and skills changed, so we did not add app tests.

## 2026-10-21: automatic review after the PR (at most 2 rounds)

### Purpose

The user told us the same day to refine the merge policy again. After a PR is opened, it goes through automatic code review at most 2 times (review → fix commit → second review → fix commit), a fix that is too big for this PR is split into a new issue card, and the PR is merged once the required CI of the final head passes. If nothing needs fixing, go straight to the CI check and the merge.

### Changes

- `skills/money-ledger-implementation/SKILL.md`: added a step "5. Automatic code review after the PR (at most 2 rounds)" between "4. Create the PR after testing" and "Merge after CI passes". It describes the first review, going straight to CI when nothing needs fixing, the first fix commit, the second review, no third review after the second fixes, the criteria for splitting off big fixes (features outside scope, design or data structure changes, fixes across several modules, work needing separate verification), the conditions that hold the merge (a defect that would break main if split off, a security or data corruption risk), and the per-round PR comment and docs record. The merge step was renumbered "6. Merge after CI passes", and we added the conditions that tests are rerun against the last commit and that a merge must not rely on an earlier CI result when a new commit appears during review. The front matter description was also changed to include the review step.
- Reflected a short summary in step 5 of the `AGENTS.md` procedure, the work order in `README.md`, `docs/project-setup.md` (shared rules, the Git strategy order, the review item, the instructions table, and the AGENTS template), and `skills/money-ledger-{foundation,testing}/SKILL.md`.
- Kept the existing prohibitions (merging with failing or running checks, bypassing protection with `--admin` or similar, approving your own PR, pushing directly to `main`, and force-pushing) and the stacked PR procedure as they were.
- Refreshed `.claude/skills/` with `npm run skills:sync` (`node scripts/claude-skills.mjs sync`). Past records (`docs/changes/bootstrap.md`, `docs/daily/`) were not edited.

### Verification

Only docs and skills changed, so we did not add app tests.

- `node scripts/claude-skills.mjs sync`: refreshed `.claude/skills/`.
- `npm run skills:check`: pass (`.claude/skills matches skills/.`).
- `node --test scripts/test/claude-skills.test.mjs`: **4 pass / 0 fail / 0 skip**.
- Prettier 3.9.10 `--check .` (whole repository): pass.
- skill-creator `quick_validate.py` (`PYTHONUTF8=1`) on the 3 skills: all `Skill is valid!`.
- This repository has no `node_modules` (`npm ci` needs the user's reconfirmation), so we ran Prettier with the executable from study-log, which has the same version (3.9.10) installed, applying this repository's settings (`.prettierrc.json`). We did not run the local `npm run check` (lint, types, app tests, build), and CI's `npm run check` covers it.
