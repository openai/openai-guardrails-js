---
name: pr-draft-summary
description: Draft a Guardrails PR from its complete final diff and carry out authorized CI and review follow-up, including stacked PRs and takeovers.
---

# PR Draft Summary

Describe the complete final change, including internal tooling and docs PRs.
Read [AGENTS.md](../../../AGENTS.md) for review, release-note, and remote-action
rules. Drafting alone does not authorize submission or messages; retain explicit
user authorization already given for the task.

## Establish the actual PR scope

Inspect the current branch, target, merge base, all branch commits, staged and
unstaged changes, and relevant untracked deliverables. Use the intended target,
not a feature branch's tracking configuration. For an explicit stack, compare
against the previous PR's branch and list the required predecessor. Check the
combined stack separately for integration and scope drift.

Keep a user-selected branch; suggest an unused `codex/<topic>` name when needed.
Do not include unrelated local notes. If the diff is empty, report that fact
rather than inventing a PR. Reconcile the summary with the final diff after fixes.

## Draft the title and body

Lead with the concrete problem or missing capability and resulting behavior.
Use a concise imperative title. Include only details needed to review the change:

- What changes and why; relevant compatibility or migration requirements.
- Actual tests/checks run, results, and material coverage limitations.
- Changeset impact when it helps clarify release behavior.
- For takeovers, the source PR and verified attribution; for split takeovers,
  identify the slice without claiming the entire original PR is complete.
- For stacks, the predecessor and ordered stack position. Explain that the
  incremental diff is against that predecessor.

Use native GitHub references (`#123` or `owner/repo#123`). Add issue-closing syntax
only when the final change fully resolves that issue and closure is intended.
Keep local paths, reviewer transcripts, internal diagnostics, and app directives
out of the external description. Do not claim a check or approval that did not run.

## Submit and follow up when authorized

Before any push or PR update, complete the repository's
[final review](../implementation-final-review/SKILL.md) and applicable
[verification](../code-change-verification/SKILL.md). Push only the intended
branches and create PRs with explicit bases. Do not rewrite another author's
branch, merge, or close a source PR merely because a replacement exists.

Monitor CI and CodeQL on the current head of every submitted PR. Both workflows
filter PR targets to main, so higher stack entries may have no automatic runs.
Inspect `.github/workflows/ci.yml` and `.github/workflows/codeql.yml`; when
needed, dispatch each workflow on each affected stack branch and verify that
every run's head SHA matches the PR. Require both workflows to pass before
reporting the head as green or requesting review. Missing checks are not passing
checks. Report an unavailable trigger or blocked run rather than weakening CI
or modifying branch protection.

Fix and re-push only failures introduced/worsened by the change or narrowly
necessary to its outcome, repeating the required review/checks before updates.
Retry evidenced transient failures; report unrelated failures separately.
Stop repeated retries when there is no new evidence or progress.

Once current-head CI and CodeQL pass, request review in root `#sdk-reviews` as
required by AGENTS.md and authorized for the task. For a stack, one message can list all PRs
in dependency order; do not post it as a thread reply. If messaging is unavailable,
report the blocker and provide the prepared request without claiming it was sent.

When addressing feedback, inspect the whole affected diff, push the reviewed
fix, then reply to the particular review thread explaining the correction and
resolve it. Do not resolve feedback that remains unaddressed. If an earlier
stack branch changes, reconcile dependent branches within the authorized scope
and revalidate affected PR heads before reporting the stack as green.
