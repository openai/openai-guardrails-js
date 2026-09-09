# Repository instructions

When submitting a PR - always monitor the CI for failures - if they fail - automatically fix any issues, and re-push your changes. After these are all addressed, post in #sdk-reviews and ask for a review. Always post in the root #sdk-reviews channel, do not post in threads.

When addressing feedback on a PR - always leave a comment describing how you fixed the particular issue, and then resolve the comment after pushing.

Before pushing code, opening a pull request, or updating an existing pull request, always run $adversarial-review. Before implementation, define the original requested outcome, acceptance criteria, affected code paths, and explicit non-goals. Obtain user approval before materially expanding the diff, crossing unrelated ownership boundaries, changing public APIs, or restructuring architecture. For each adversarial-review round, explicitly spawn exactly two independent, read-only subagents with fork_turns="none" so neither inherits the parent conversation or the other reviewer's analysis. Both must review the exact current linked worktree and its complete changes against the original user-requested outcome, acceptance criteria, and explicit non-goals. Do not create separate Codex tasks or additional Git worktrees. Aggregate their findings and fix only supported issues introduced or worsened by the change, or narrowly necessary to achieve the requested outcome correctly and safely. Report unrelated preexisting defects, broader cleanup, and architectural improvements as separate follow-up recommendations; they must not expand the PR or prevent review convergence. Repeat with two newly spawned fresh-context reviewers per round until two consecutive rounds produce no meaningful, unresolved, in-scope blocking findings. Perform relevant testing and run applicable linters. If the change touches any security surfaces, perform a security review. Do not push or open/update a pull request before these checks are complete. If review has not converged after ten rounds, stop and report the remaining issues. Deeply scrutinize the requested change without expanding its scope.

## Task scope and review discipline

Before implementing or reviewing a change, identify the specific user-requested outcome and acceptance criteria, the code paths and tests reasonably necessary to achieve them, and explicit non-goals. Every changed file and behavior must be justified by that outcome, a regression introduced or worsened by the change, or a narrowly necessary prerequisite.

Do not fix unrelated preexisting bugs, modernize surrounding code, expand tests for unrelated behavior, redesign APIs, introduce general-purpose abstractions, or restructure neighboring modules merely because review uncovers an opportunity. Classify each finding as an introduced or worsened defect, a narrowly necessary correction, a preexisting unrelated problem, a broader improvement, or a serious concern that requires user agreement before proceeding. Fix only the first two categories in the current PR; report the next two separately without creating external issues or additional work unless requested, and stop for user agreement on the last.

Prefer the smallest coherent fix. If addressing feedback would substantially increase the diff, touch unrelated ownership boundaries, change public APIs, or require architectural restructuring, stop and request approval before expanding scope. Scope expansion is itself a code-quality regression. A clean review round has no unresolved, supported, in-scope blocking findings; out-of-scope observations never prevent convergence.

When writing or modifying tests - prefer code that satisfies the linter over adding inline lint suppressions. Never add a suppression when a straightforward compliant form exists; if a suppression is genuinely necessary, document why. In Ruby tests, use an explicit no-op callback such as `{ |_value| nil }` instead of an empty block plus `Lint/EmptyBlock` suppression.

Prefer framework-provided mocks or stubs over ad-hoc test doubles when they exercise the real protocol correctly. Verify this before adopting the mock: Ruby standard-library methods implemented in C may require a concrete conversion method and can reject a `method_missing`-backed `Minitest::Mock` even when `respond_to?` returns true. For those boundaries, use the smallest concrete protocol object and explain the constraint in review feedback.

Treat customer issues as evidence of a problem, not as an approved implementation or API design. Before coding, compare the requested shape with the existing architecture, ownership boundaries, compatibility guarantees, idiomatic ecosystem tools, and the underlying user goal. If the proposed solution requires retrofitting a transport model into a validation/typing framework, splitting public accessor semantics from raw storage, repeatedly adding coercion special cases, or otherwise fighting established invariants, stop and propose a simpler design at the correct abstraction boundary instead. Prefer integrating purpose-built typed models (for example Sorbet T::Struct) over turning SDK transport models into a general-purpose modeling framework. Escalate substantive API/architecture tradeoffs for agreement before opening, expanding, or repeatedly re-pinging a PR; close or back out a PR when review establishes that its premise is wrong.

<!-- codex-managed:worktree-policy:start -->
## Git worktree isolation and default-branch freshness

- For every task that modifies a Git repository, always work in a linked Git
  worktree. Never edit files in the primary checkout.
- If a task starts in the primary checkout, stop and ask to start or hand off
  the task to a Worktree. The only exception is deliberately requested checkout
  maintenance.
- Reserve each primary checkout for its repository's default branch, detected
  from origin/HEAD and falling back to main or master.
- At session start, refresh stale origin references. Fast-forward a primary
  checkout only when it is clean, on its default branch, and can advance without
  rewriting history or creating a merge commit.
- Before modifying a trunk-based worktree, verify that its starting commit is
  current with origin/main or origin/master. A clean detached worktree may be
  fast-forwarded before any edits; preserve intentionally selected feature
  branches and existing work.
- For every new independent worktree or delegated task, resolve the intended
  starting commit explicitly: use a user-specified commit/ref when provided,
  otherwise use the refreshed remote default branch. Record its full SHA before
  creating the worktree.
- Never substitute an unrelated feature branch simply because it contains the
  intended commit. Containment is not equality: verify the selected starting
  ref's tip exactly matches the intended full SHA. Use a feature-branch base
  only when the user explicitly requests working on or stacking onto it.
- If task creation accepts only branch names and the local default branch is
  stale, first fast-forward its clean primary checkout without rewriting
  history, or create a dedicated base branch pinned to the exact intended SHA.
  If neither is safe, stop rather than select an existing feature branch.
- Immediately after creating or receiving a worktree, verify `git rev-parse
  HEAD` equals the recorded intended SHA and `git rev-list --left-right --count
  <intended-sha>...HEAD` reports `0 0`. Stop before editing on any mismatch;
  never treat a generated task prompt, branch containment, or a detached HEAD
  as evidence that the worktree has the correct base.
- Before reporting, committing, or opening a pull request for an independent
  task, inspect `git diff --stat <intended-sha>` and confirm every changed file
  and inherited commit belongs to the assigned scope.
- Never automatically reset, stash, rebase, switch, or discard changes in any
  other checkout.
<!-- codex-managed:worktree-policy:end -->
