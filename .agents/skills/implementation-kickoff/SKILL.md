---
name: implementation-kickoff
description: Start or resume a requested Guardrails implementation or PR takeover in the selected linked worktree with bounded scope and verification.
---

# Implementation Kickoff

Start from the user's actual implementation request. An investigation or a plan
alone is not permission to implement, push, or publish. Preserve authorization
already given; this skill adds none. Apply [AGENTS.md](../../../AGENTS.md) and
[implementation-strategy](../implementation-strategy/SKILL.md) where applicable.

## Establish the checkout and scope

Record the original outcome, acceptance criteria, affected paths, non-goals,
and intended base. Reuse the current task's selected linked worktree. If running
in a primary checkout, follow AGENTS.md and ask to start or hand off to a worktree.
Do not automatically create another worktree or change unrelated checkouts.

Refresh remote references and record the full intended starting SHA. For a new
independent task use the refreshed default branch unless the user chose another
base. For an explicitly requested stack, use the exact previous slice's tip.
Verify the checkout equals that SHA before editing a new task. For a resumed
task, preserve its existing changes and record HEAD plus the original comparison
base instead of resetting it to main. Stop on an unexplained base mismatch.

Inspect tracked and untracked state before edits. Keep task deliverables distinct
from existing user work and operational plans/review notes. Use `codex/` branch
names by default, preserving an explicitly selected branch or user preference.

## Take over an existing PR

Read current metadata, author commits, discussions, and the complete PR diff.
Confirm the PR is still an appropriate source. Preserve its underlying outcome,
but evaluate the proposal against the current architecture and toolchain.
Import only the accepted scope; a takeover does not require copying the entire
patch or preserving intermediate commits.

Record the source PR and verified author/coauthor identities. Credit adapted
work with valid `Co-authored-by` trailers, without inventing identities. If the
identity needed for attribution cannot be verified, resolve it before committing.
For a split takeover, describe each slice as part of the replacement effort;
do not claim the first slice completes the whole source PR.

## Implement and verify

Keep changes within the agreed scope. Preserve user work and avoid automatic
stashing, rebasing, or rewriting unrelated branches. Check integration with an
advanced target before submission; if an update is needed, handle only this
task's branch and rerun checks/review affected by any content change. Do not
force a detached checkout, one-commit topology, or history rewrite to manufacture
a clean handoff.

Use [verification](../code-change-verification/SKILL.md) and
[final review](../implementation-final-review/SKILL.md) before pushing or creating
or updating a PR. Follow the [release guide](../../../.changeset/README.md):
ordinary user-visible SDK changes need a changeset; internal workflow changes
need none. Leave version and changelog generation to the release PR.

## Handoff

Inspect status, full diff statistics, and every task commit before staging or
reporting. Stage only task-owned deliverables; keep local planning and review
artifacts out of the PR. Preserve hooks and inspect the committed result.

Report branch, base, commit, requested outcome, verification, review status, and
remaining blockers. When authorized to submit, follow AGENTS.md for current-head
CI monitoring, scoped fixes, root-channel review requests, and feedback replies.
For a requested stack, create each PR against its predecessor and verify that
relationship. Do not assume all workflows run on feature-branch PR targets:
inspect triggers and use an authorized manual CI run on each head when needed.
Never merge or close the source PR without authorization.
