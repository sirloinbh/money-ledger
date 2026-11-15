---
name: std-testing
description: Write or update behavior-focused tests with implementations and fixes in a sirloinbh app repository, run them before commits and PR creation or updates, and record actual results. Use with std-implementation; for documentation-only changes validate the changed artifacts instead of adding unrelated app tests.
---

<!-- Managed file. Edit it in sirloinbh/project-standards templates/app/skills/std-testing/ -->

# Money Ledger Writing and Running Tests

Follow the project's `AGENTS.md`, `AGENTS.project.md`, and the [std-implementation](../std-implementation/SKILL.md) procedure together with this skill. This skill sets the standard for writing and running tests. It does not change the issue, branch, docs, and PR procedure or the merge policy. The test tools installed in the project and their locations are in `AGENTS.project.md`.

## Write tests with the implementation or fix

- When you implement a feature or change behavior, add or update tests that verify that requirement, and put the implementation and the tests in the same commit. Do not let running existing tests stand in for verifying the new feature.
- For a bug fix, add a regression test that catches the bug if it comes back. If possible, confirm it fails before the fix and passes after; if you cannot reproduce the bug, record that limit.
- For a refactor, verify that existing behavior is preserved. Add the scenarios that are missing.
- Verify results the user can see and domain rules, rather than writing tests that repeat the internal implementation. Pick the happy path plus the invalid input, boundary, and failure paths that relate to the change.
- Pick unit tests for business logic, integration tests for API, DB writes, and transactions, and component or browser tests for screen input and save flows. Do not add every kind of test to every change.
- Check the test tools and commands that are installed now. Do not report as if you used a tool the project has not adopted yet (Vitest, Playwright, and so on).
- Keep test data separate from production and user data. Use a dedicated DB for tests, such as `money_test`. Write checks that depend on time, dates, or random values so they verify the same meaning when the runtime environment changes.

## Before a commit

- Check the changes and tests that will be in the final commit, and actually run the relevant tests. Put the implementation, tests, and docs record in the same commit.
- Record the test code paths, the behavior you verified, and the run commands and results in the `docs/changes` record for that issue.
- Do not make a failing test pass by skipping it, deleting it, or weakening its assertions. Fix the failure, then commit.
- If you cannot prepare the environment needed to run the tests, record that you did not run them. Do not report unverified work as done, and hand off a PR with remaining verification as a draft.

## Before creating or updating a PR

- Run the relevant tests and the project's required checks against the final diff, and confirm they pass. If nothing changed after the commit and the results for the same target are still valid, do not repeat the same checks.
- In the PR, list the tests you added or changed, the run commands, pass/fail/skip, and the reason for anything you did not run. Do not count an integration test that was skipped because the DB environment variables were missing as a pass.
- If you change code or tests after the PR is open, rerun the affected checks and update the results in the docs and the PR. Fix CI failures too.
- If only docs, skills, or formatting changed and app behavior did not change, verify with the validators, formatters, and link checks for those artifacts, and write why you did not add app tests.
