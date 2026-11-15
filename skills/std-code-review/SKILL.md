---
name: std-code-review
description: Review pull requests with one shared standard: approve once a change improves code health, check design, behavior, tests, and security in a fixed order, and label every comment with Conventional Comments so the author knows what blocks merging. Use when reviewing a PR (including sync PRs and your own PR before merging) and when answering review comments, in any sirloinbh project repository. Who merges still follows the repo's AGENTS.md.
---

<!-- Managed file. Edit it in sirloinbh/project-standards templates/common/skills/std-code-review/ -->

# Reviewing pull requests

How to review a PR and how to answer a review. It is based on [Google's engineering practices](https://google.github.io/eng-practices/review/) and [Conventional Comments](https://conventionalcomments.org/), adapted to these repos. Writing the PR itself follows [std-git-writing](../std-git-writing/SKILL.md). Who merges follows the repo's `AGENTS.md`.

## 1. The standard

**Approve a change once it clearly improves the overall health of the code, even if it is not perfect.**

- The goal is steady improvement, not perfection. Do not block a good change because it is not the change you would have written.
- Decide on engineering grounds and data, not taste. If the author shows their approach is as good as the alternatives, accept it.
- Formatting and style are settled by the formatter, the linter, and the repo's conventions, not by the reviewer.
- A change that makes the code worse is not approved, however small. "We will clean it up later" needs a registered issue, not a promise.

## 2. Before reading the code

1. Read the PR body. It must have the sections of std-git-writing section 5: What changed, Why, Main changes, Verification, Check before merging, Impact, `Closes #number`. Missing sections are a `todo:`.
2. Read the linked issue. Compare its "Done when" items with the diff and with "Verification".
3. Check CI. A red check is reviewed as a failure, not as noise. A flaky test gets its own issue.
4. If the PR is too large to review well (unrelated purposes mixed, or about 20 or more changed files that do not share one purpose), ask the author to split it before reviewing (std-backlog section 1).

## 3. What to look for, in this order

1. **Design:** Does this change belong here? Does it fit the rest of the system?
2. **Behavior:** Does it do what the issue asks? Edge cases, error paths, concurrency, and what users will actually see.
3. **Complexity:** Could it be simpler? Is anything built for a future that may never come?
4. **Tests:** Are there tests, and would they fail if the code broke? Are they readable?
5. **Security:** Input validation, auth checks, injection, unsafe deserialization. No tokens, secrets, `.env` values, or personal paths in code, docs, PRs, or logs.
6. **Naming:** Do names say what things are and do?
7. **Comments and docs:** Do comments explain why? Are docs, `docs/changes/`, and the PR body updated with the behavior?
8. **Consistency:** Does it follow the existing patterns and the repo's rules?
   - Centrally managed files (with a "Managed file" header) are changed in `sirloinbh/project-standards`, not in the downstream repo.
   - In `project-standards`, a source and its copies change in the same PR (`.claude/rules/sources-and-copies.md`).
   - New text is in English.

Read every line you are asked to review, and look at the surrounding code, not only the diff. Point out what was done well, too.

## 4. Writing review comments (Conventional Comments)

Start every comment with a label so the author knows at once whether it blocks merging.

```text
<label> [(decorations)]: <subject>

[discussion: why, and what to do instead]
```

| Label | Meaning | Blocks merging? |
|---|---|---|
| `praise:` | Something done well. Be specific | No |
| `nitpick:` | A small preference | No |
| `suggestion:` | A proposed improvement. Say what and why | Add `(blocking)` or `(non-blocking)` |
| `issue:` | A specific problem. Pair it with a suggestion when you can | Yes, unless marked `(non-blocking)` |
| `todo:` | A small, necessary change | Yes |
| `question:` | You need an answer before deciding | Until answered |
| `thought:` | An idea for later. Not a request | No |
| `chore:` | A process step before merging, such as a missing change record or snapshot update | Yes |

Decorations go in parentheses after the label: `(blocking)`, `(non-blocking)`, `(if-minor)` (fix it only if the fix is small), `(security)`, `(test)`.

Examples:

```text
issue (security): the user id comes from the request body

Any user could update another user's profile by changing `userId`.
Use the id from the session instead.
```

```text
suggestion (non-blocking): extract the date parsing into a helper

The same logic appears in `orders.ts` and `invoices.ts`.
```

```text
chore: add the change record

`docs/changes/497-code-review-skill.md` is missing (AGENTS.md step 3).
```

```text
nitpick: `data` → `unpaidInvoices` would make this loop easier to read.
```

```text
praise: the table-driven tests make the edge cases very clear.
```

### Tone

- Comment on the code, not the person: "this function", not "you".
- Explain why. Link the doc, skill, or issue when you cite a rule.
- Ask a question when you are not sure, instead of asserting.
- Many small nitpicks: batch them in one comment or leave them out.
- Write comments in English, following std-git-writing section 1.

## 5. Review speed

- Respond within one working day. A first response can be "I will review this by tomorrow afternoon".
- Review in one pass where you can, so the author gets all feedback at once.
- A review an agent does as part of its procedure (for example a sync PR) happens before reporting the PR as ready.

## 6. The decision and merging

| Decision | When |
|---|---|
| Approve | No blocking comment is left. Approving with non-blocking nitpicks is fine |
| Comment | Questions only; no decision yet |
| Request changes | At least one open `issue:`, `todo:`, `chore:`, or `(blocking)` comment |

- **Who merges follows the repo's `AGENTS.md`**; if it says nothing, only the user merges. A review never replaces that rule: do not merge, enable auto-merge, or approve in place of merging where `AGENTS.md` does not allow it.
- **"Check before merging":** if it has an item that needs the user's judgment, do not merge, even when the review passes. Ask the user.
- **Same account:** when the agent and the PR author use the same GitHub account, GitHub does not allow approving your own PR. Record the review as a PR comment (or on the issue, as `AGENTS.md` says for sync PRs) that starts with the decision, such as `Review: approve — no blocking comments`.
- **Merge method:** these repos merge with a merge commit (`pr merge --merge`). Do not squash, so the review commits stay in history. Do not add `--delete-branch` (std-git-writing section 3).

## 7. For authors

- Keep PRs small and focused: one purpose that one review can cover (std-backlog section 1).
- Review your own diff first, with section 3. Leave comments on tricky lines before the reviewer asks.
- Answer every comment: fix it, or reply with your reasoning. Do not resolve a reviewer's thread without answering it.
- Push fixes as new commits during review so the reviewer can see what changed. Do not force-push.
- When you add commits, update "Main changes", "Verification", and `Closes` in the PR body (std-git-writing section 5).
- A disagreement that two rounds of comments do not settle goes to the user. Write the outcome back in the PR.
