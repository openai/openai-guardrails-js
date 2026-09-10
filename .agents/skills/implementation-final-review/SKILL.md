---
name: implementation-final-review
description: Prepare independent review of a complete Guardrails change before pushing or updating a PR, using the repository adversarial-review procedure.
---

# Implementation Final Review

Apply the adversarial-review procedure in [AGENTS.md](../../../AGENTS.md).
Use the installed `$adversarial-review` skill when available; otherwise follow
that inline procedure. This skill supplies a reusable brief, not another gate.
It applies to repository workflow changes as well as runtime changes before a
push or PR update.

## Prepare the complete scope

Record the exact selected linked worktree, current HEAD, intended target, and
comparison base SHA. Resolve the merge base with that target; for an explicitly
requested stack, the previous PR's branch is the target. Inspect both the full
stack and each incremental PR when reviewing several stacked changes together.
Reviewers must check that every intermediate PR stands alone and references
only files or skills present at that point.

Include all branch commits from the comparison base, staged and unstaged
changes, and relevant untracked deliverables. Ordinary `git diff` omits
untracked files; provide their paths and contents explicitly. Distinguish local
working notes from shipped files. Include individual commit diffs so an endpoint
diff cannot conceal unrelated changes. Freeze task content while reviewers run.

Read [reviewer-brief.md](references/reviewer-brief.md) when preparing dispatch.
Fill it with the original outcome and constraints; do not include previous
reviewers' conclusions or the implementer's preferred answer.

## Dispatch and converge

For each round, spawn exactly two new independent, read-only subagents with
`fork_turns="none"`, both in this same worktree. Spawn both before waiting.
Give each a complete self-contained brief. Reviewer A checks correctness,
compatibility, security boundaries, and evidence. Reviewer B checks ownership,
architecture, maintainability, and unnecessary complexity. Both inspect the
entire change. They must not edit, modify Git state, or spawn agents.

Aggregate supported findings and classify them using AGENTS.md. Fix only
in-scope blockers. Require two consecutive clean rounds on unchanged content,
with a fresh pair in every round and no more than ten rounds. A substantive
change resets the clean-round count. Do not substitute a self-review or reused
agent when fresh reviewers are unavailable; stop before pushing and report the
limitation. Do not create additional tasks or worktrees for reviewers.

## Close the review

Run applicable [verification](../code-change-verification/SKILL.md), including
focused evidence for repairs. Review any touched security surface and check
[Changesets requirements](../../../.changeset/README.md). Internal-only workflow
changes need no package release note. Preserve commit hooks; if committing or
later edits change reviewed content, repeat the invalidated checks and review.

Report scope, reviewer rounds, resolved in-scope findings, separate follow-ups,
and actual verification results. Record evidence in working notes outside the
shipped diff; no review-state certificate or component-credit reuse is needed.
A clean local review does not authorize a merge or replace current-head CI.
