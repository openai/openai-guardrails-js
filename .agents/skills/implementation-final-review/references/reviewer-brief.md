# Independent reviewer brief

Fill in every field before dispatch. Give each reviewer the same scope and its
own lens; do not share the other reviewer's analysis or previous conclusions.

- **Worktree:** absolute path to the selected linked worktree.
- **Expected HEAD:** full SHA; verify it read-only before reviewing.
- **Target and comparison base:** target branch and resolved full merge-base SHA.
- **Original outcome and acceptance criteria:** the user's required result.
- **Affected paths and contracts:** implementation and relevant tests/docs.
- **Non-goals:** explicit limits, including unrelated preexisting defects.
- **Complete diff:** branch commits, staged/unstaged changes, and a list of
  relevant untracked deliverables. Identify operational notes separately.
- **Stack, if any:** ordered base/head SHAs, intended PR scope, and acceptance
  criteria for each slice; inspect each incremental diff and the combined result.
- **Lens:** A: correctness, edge cases, failure modes, compatibility, security,
  and test evidence. B: architecture, ownership, maintainability, performance,
  complexity, and ecosystem fit. Both lenses cover the complete diff.

Read the repository AGENTS.md for review and scope rules. Use the supplied HEAD
as the intended checkout; do not fetch, switch, create a worktree, or select a
new baseline. Stop and report if HEAD differs. Do not edit files, modify Git
state, create tasks/PRs/comments, or spawn agents.

For each supported finding, return priority, file/line, concrete impact,
evidence, the smallest remedy, and one classification:

1. Introduced or worsened defect: in-scope blocker.
2. Narrowly necessary correction: in-scope blocker.
3. Preexisting unrelated issue: separate follow-up.
4. Broader improvement: separate follow-up.
5. Serious concern requiring user agreement before a larger change.

Require a matching, accurate changeset only for material package-user impact;
for generated release PRs assess the generated version and changelog instead.
Include a scoped security assessment if the changed surface requires one.
Do not block on unsupported concerns, wording preferences, or unrelated cleanup.
If no meaningful in-scope blockers remain, say so explicitly and identify any
limits to the review evidence. For a stack, report the result for each slice.
