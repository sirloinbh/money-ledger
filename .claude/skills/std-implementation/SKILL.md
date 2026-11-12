---
name: std-implementation
description: Follow the issue, numbered branch, implementation with docs, tests, and PR workflow for changes to a sirloinbh project repository. Use for code, configuration, documentation, and skill edits; exclude read-only questions and recommendations. Merge only as the repository's AGENTS.md allows.
---

<!-- Managed file. Edit it in sirloinbh/project-standards templates/common/skills/std-implementation/ -->

# Implementation procedure

This skill applies to changes in the `sirloinbh/money-ledger` repo. First read the project root `AGENTS.md` (and `AGENTS.project.md` if present) and the related docs. Follow the steps below and deliver a verified PR as the result.

Skills used together:

- [std-backlog](../std-backlog/SKILL.md): splitting issues, priority and characteristic labels, choosing the next task
- [std-git-writing](../std-git-writing/SKILL.md): how to write issues, branches, commits, and PRs, plus templates
- [std-testing](../std-testing/SKILL.md): writing and running tests (app repos)

## Decisions: proceed with the default

Do not stop to ask the user to choose when a sensible default exists. Pick the default, continue, and record the choice so the user can reverse it later. Several worktrees often run at once, and every question stalls one of them.

- Proceed without asking when there is a conventional default, the code or existing docs settle the choice, or the choice is easy to reverse (naming, file placement, wording, ordering, which of two equivalent approaches).
- Ask first only for decisions that are truly the user's: irreversible actions, costly actions, actions that become public, actions that conflict with the requirements, merges into production (app repo `main`), steps the issue marks as user-only (`[Manual]`, `needs-user`), package installs outside pre-approved scope, and anything the issue marks as "user confirmation". Keep working on the other parts of the task while waiting.
- Write each choice made without asking in the PR "Check before merging" section as a line such as "Chose X over Y because Z. Say so if you want Y." Add the same line to the `docs/changes/` record.
- If an item in "Check before merging" needs the user's answer before merging, say so in the PR and do not merge.

## 1. Register the issue

- Check the GitHub remote URL and `gh api user --jq .login`. The expected account is `sirloinbh`. If it is a different account, make no remote changes until authentication is fixed.
- Reuse an issue the user named, or one already registered for the same request. Check existing results before retrying so you do not create duplicate issues.
- Write a new issue with the splitting and label rules of std-backlog and the issue template of std-git-writing. An issue card means a GitHub Issue. Do not create or link a Projects board unless one was specified.
- Write the body to a temporary UTF-8 file and register it with `--body-file`. Do not include tokens or secrets.
- Keep the real issue number and URL that were issued. If registration fails, do not invent a number or start code changes first.

## 2. Create a branch from the issue number

- Check the working tree and current branch. If there are changes from other work, keep them and do not mix tasks.
- The default target branch is `main`. Do not start new work from an unrelated unmerged branch. In a clean working tree, fetch the remote main and branch from it.
- Name the branch by the std-git-writing rule (`<type>/<number>-<english-summary>`).
- If a branch for the same issue already exists, check its state and continue on it.
- Make changes and commits on this branch. Do not commit or push directly to `main`.

## 3. Implement and record docs per commit

- In app repos, read std-testing and write or update the related tests together. Add a regression test for a bug fix. Put the implementation, tests, and docs in the same commit, and run the related tests before committing.
- Implement only the requested scope. For development foundation cleanup, also read std-foundation.
- Create `docs/changes/<number>-<slug>.md` and record the issue link, purpose, changes, verification, and limits or follow-up work.
- **In each work commit, also record that commit's changes and verification in docs.** You may accumulate entries in one issue document.
- Record why the change was made and the observed results. Do not claim a check or deployment is done if it was not run.
- Write commit messages in the std-git-writing format (`<type>: <what was done> (#number)`).
- Before staging, check the diff for secrets, and stage only the related files by name.

## 4. Test, then create the PR

- Before creating or updating a PR, run the related tests and required checks on the final change. Follow the project `AGENTS.md` for the required commands and the DB integration test conditions.
- Fix failures, and record in docs and the PR, separately, any checks that could not run, skipped DB tests, and unfinished browser verification. If a needed verification is blocked, create the PR as a draft.
- Push only the work branch. The PR target is this repo's `main`. The subtree sync script pushes to main and to the child repositories, so do not use it in this step.
- If a PR for the same head branch exists, update it instead of creating a new one.
- Write the PR title and body with the std-git-writing PR template. Pass the body as a UTF-8 file.
- Check the GitHub Actions results and resolve related failures. Report checks that are still running as running.

## 5. Merge

- Who merges follows the project `AGENTS.md`. If it is not specified, **only the user merges.**
- Repos where the user merges: hand over the issue URL, branch, PR URL, verification results, and remaining work, and leave the PR open. Do not use auto-merge, add it to a merge queue, call the merge API, or integrate into main directly. Do not approve your own PR in place of user review. Do not read a general "continue" as permission to merge.
- Let the issue close when the PR is merged.

## Authentication and failure handling

Do not ask again, without need, for issue, push, and PR permissions already given. Respect the execution permissions the tool requires and GitHub authentication. On failure, restart from the step that was completed, and if the result of a remote creation is unclear, look it up before retrying. Do not work around an account or authentication problem with another account.
