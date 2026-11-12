---
name: money-ledger-implementation
description: Follow the user's issue, numbered branch, implementation with docs, tests, PR, up to two automated review rounds, and merge-after-CI workflow for changes to the sirloinbh money-ledger project. Use for code, configuration, documentation, and skill edits; exclude read-only questions and recommendations. Review each PR at most twice with fix commits, split large fixes into new issues, merge with a merge commit once required CI passes, and resolve conflicts between stacked PRs.
---

# Household ledger, assets, and mock investing: implementation procedure

This skill applies to changes in `sirloinbh/money-ledger`. Do not apply this account, repository, or policy to other projects. First read `AGENTS.md` at the project root and the related docs. Follow the order below, go through automatic code review after the PR (at most 2 rounds), and finish by merging a PR whose required CI has passed.

## 1. Register an issue card

- Check the GitHub remote URL and `gh api user --jq .login`. The expected account is `sirloinbh`. If it is a different account, do not make remote changes until authentication is fixed.
- Reuse the issue the user named or an issue you already registered for the same request. Check for an existing result before retrying so you do not create a duplicate issue.
- In a new issue, write the problem and purpose, the requested scope, the done criteria, and the verification method. In this project an issue card means a GitHub Issue. Do not create or link a Projects board unless a separate one was specified.
- Write the body to a UTF-8 temporary file and register it with `gh issue create --repo sirloinbh/money-ledger --title ... --body-file ...`. Do not put tokens or secrets in the body.
- Keep the real issue number and URL that were issued. If issue registration fails, do not invent a number or start code changes first.

## 2. Create a branch from the issue number

- Check the working tree and the current branch. If there are changes from other work, preserve them and avoid mixing work.
- The default target branch is `main`. Do not start new work from an unrelated unmerged work branch. From a clean working tree, fetch the remote main and branch from it. If there are user changes, prepare a workspace that can preserve them.
- Branch name: `<type>/<number>-<short-slug>`. Examples: `feat/12-first-feature`, `fix/13-goal-date`, `docs/14-project-skills`, `chore/15-ci`.
- If a branch for the same issue already exists, check its state and continue on it.
- Make changes and commits on this branch. Do not commit or push directly to `main`.

## 3. Implementation and a docs record for each commit

- When you implement or fix something, read the project's `skills/money-ledger-testing/SKILL.md` and write or update the related tests together. A bug fix adds a regression test. Put the implementation, the tests, and the docs in the same work commit, and run the related tests before committing.
- Implement only the requested scope. For development foundation work, also read `money-ledger-foundation`.
- Create `docs/changes/<number>-<slug>.md` and record the issue link, the purpose, the changes, the verification, and the limits and follow-up work.
- **Record the changes made and the verification done in each work commit in the docs together with that commit.** You may accumulate entries in one issue document. A commit that only edits docs also updates the matching work record.
- Record the reason for the change and the observed results. Do not write that a check or deployment is done when you did not run it. You do not need to make up a SHA that points at the commit itself. Distinguish entries by commit title or unit of work.
- The commit title includes the type and the issue number, like `feat: ... (#12)`, `fix: ... (#13)`, `docs: ... (#14)`.
- Before staging, check the diff and whether it contains secrets, and stage only the related files, by name. Do not include another user's changes.

## 4. Create the PR after testing

- Before you create or update a PR, run the related tests and the required checks on the final change. Record in the docs and the PR the test code you added or changed, the behavior verified, the real commands that ran, and pass, fail, or skip. Follow the project `AGENTS.md` for the required commands and the conditions for DB integration tests. Do not add unnecessary app tests for a simple docs or skill edit.
- Fix failures, and separate in the docs and the PR the checks that could not run, the DB tests that were skipped, and the browser verification that is not finished. If required verification is blocked, create the PR as a draft.
- Push only the work branch. The PR target is `main` of `sirloinbh/money-ledger`. The subtree sync script pushes main and the sub-repositories, so do not use it in this step.
- If a PR for the same head branch exists, update it and do not create a duplicate.
- Pass the PR body as a UTF-8 file. Include the problem and the behavior after the change, the main changes, the real check commands and results, evidence for screen changes where possible, and `Closes #<number>`. If there are no images, say why and state the limits of the verification.
- Check the GitHub Actions results and fix related failures. Say so when a check is still running. If you changed code after creating the PR, rerun the affected checks and update the docs and PR results.

## 5. Automatic code review after the PR (at most 2 rounds)

After you open the PR, go through automatic code review at most 2 times. If there is nothing to fix, go straight to the CI check and the merge.

1. **First review**: after you open the PR, run a read-only review separate from the authoring context (a separate agent, a review tool, and so on). Based on the issue's done criteria and the whole PR diff, look at correctness, regressions, security, missing tests, and the docs record.
2. **If nothing needs fixing**, end the review and go on to the CI check and the merge.
3. **If something needs fixing**, address only the comments that belong in this PR's scope. Make a follow-up commit that includes the related tests and the docs record, and push it.
4. **Second review**: check that the first-round comments were addressed and look at the added diff. Also look at the final whole PR diff. If nothing needs fixing, go on to CI.
5. **Second-round fixes**: address the second-round comments in a follow-up commit. The review is at most 2 rounds, so do not run a third review and go on to CI.
6. **Split large fixes**: do not fix comments of the following kinds in this PR. Instead, create a new issue card (with the problem, scope, and done criteria) in `sirloinbh/money-ledger`. Leave the issue link in a PR comment and in the docs record, and keep going with this PR.
   - Features outside the requested scope
   - Changes to design or data structure
   - Fixes that span several modules
   - Work that needs separate verification
7. **Hold the merge**: if either of the following defects remains, do not merge and tell the user.
   - A defect that would break main if split off
   - A defect with a security or data corruption risk
8. **Record**: leave the result of each review round in a PR comment and in `docs/changes/<number>-<slug>.md`. Write the comments, the commits that addressed them, the issues split off, and whether there was nothing to fix.

## 6. Merge after CI passes

- Rerun the related tests against the last commit. If a new commit appears during review, do not merge on the earlier CI result, and rely on the required CI result of the final head.
- When all required CI checks of the PR pass, the agent (the main agent or a local worker) merges without asking the user. Record the head SHA you verified and run `pr merge <url> --merge --match-head-commit <head SHA>` (merge commit) with the project wrapper.
- After the merge, check that the linked issue (`Closes #<number>`) is closed. Report the issue URL, the branch name, the PR URL, the merge SHA, the verification results, and the remaining work.
- Merge stacked PRs in order. When the earlier PR is merged, merge `origin/main` into the next PR branch to resolve conflicts, rerun the related tests, push normally, wait for CI to pass, and merge. Repeat to the last PR.
- **Do not merge while any check has failed or is still running.** Do not bypass branch protection with `--admin` or similar, replace a review by approving your own PR, commit or push directly to `main`, or force-push. If you cannot fix a CI failure, leave the PR open and report the cause.
- Merging to `main` does not trigger a deployment right now (deployment is not connected). If deployment is wired to run on merge, add a check of the post-merge deployment result to this procedure.

## Authentication and failure handling

Do not recheck issue, push, and PR permissions that were already given. Respect the run permissions the tool requires and GitHub authentication. On failure, resume from the step you completed, and if the result of a remote creation is unclear, query it before retrying. Do not work around an account or authentication problem by creating things with a different account.
