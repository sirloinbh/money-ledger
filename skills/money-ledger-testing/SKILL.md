---
name: money-ledger-testing
description: Write or update behavior-focused tests with money-ledger implementations and fixes, run them before commits and PR creation or updates, and record actual results. Use with money-ledger-implementation; for documentation-only changes validate the changed artifacts instead of adding unrelated app tests.
---

# Household ledger, assets, and mock investing: writing and running tests

Follow the project's AGENTS.md and the money-ledger-implementation procedure together with this skill. This skill sets the standard for writing and running tests. It keeps the issue, branch, docs, and PR procedure, the automatic code review after the PR (at most 2 rounds), and the merge-after-CI policy.

## Write tests together with the implementation or fix

- When you implement a feature or change behavior, add or update test code that verifies that requirement, and put the implementation and the tests in the same work commit. Running the existing tests does not replace verifying the new feature.
- For a bug fix, add a regression test that catches the bug if it comes back. When possible, confirm that it fails before the fix and passes after it. If you cannot reproduce the failure, record that limit.
- For a refactor, verify that existing behavior is preserved. If the related tests are enough, keep them as they are, and add tests for any scenario that is missing.
- Prefer tests that verify what the user sees and the domain rules over tests that repeat the internal implementation. Choose the normal path plus the input errors, boundaries, and failure paths that relate to the change.
- Choose unit tests for business logic, integration tests for API, DB writes, and transactions, and component or browser tests for screen input and save flows. Do not add every kind of test to every change.
- Check which test tools and commands are installed now. Do not report using Vitest, Playwright, or other tools that are not yet adopted as if they were installed.
- Keep test data separate from production and user data. Write checks that depend on time, dates, or random values so they verify the same meaning when the run environment changes.

## Before committing

- Check the changes and tests that will be in the final commit, and actually run the related tests. Put the implementation, the tests, and the docs record in the same commit.
- Record the test file paths, the behavior verified, and the commands and results in the matching issue record under docs/changes.
- Do not make a failing test pass by skipping it, deleting it, or weakening its assertions. Fix the failure, then commit.
- If you cannot prepare the required run environment, record that you did not run the tests. Do not report an unverified implementation as done, and hand over a PR with remaining verification as a draft.

## Before creating or updating a PR

- Run the related tests and the project's required checks on the final diff and confirm they pass. If nothing changed after the commit and the result for the same target is still valid, you do not need to repeat the same check.
- Record in the PR the tests you added or changed, the commands, pass, fail, or skip, and the reason for anything not run. Do not count an integration test that was skipped because the DB environment variable was not set as a success.
- If you fix code or tests after the PR is open, rerun the affected checks and update the docs and PR results. Fix CI failures too.
- If only docs, skills, or formatting changed and app behavior did not, validate with that artifact's validator, formatter, and link checks, and state why you did not add app tests. A behavior change in executable code or check scripts includes related tests or a run-time verification.
- Put the related tests in the follow-up commits that address automatic code review comments too, and rerun the related tests against the last commit.
- Merge the PR only after all required CI checks pass. Do not merge while any check has failed or is still running.
