# Repository instructions

When submitting a PR, always monitor CI for failures. Automatically fix and re-push only failures introduced or worsened by the change, or narrowly necessary to achieve the requested outcome. Report unrelated preexisting failures and retry transient or flaky checks when appropriate; do not expand the diff to fix them. Once CI passes, post in #sdk-reviews and ask for a review. Always post in the root #sdk-reviews channel, do not post in threads.

When addressing feedback on a PR - always leave a comment describing how you fixed the particular issue, and then resolve the comment after pushing.

Before pushing code, opening a pull request, or updating an existing pull request, always complete the adversarial-review procedure below. Use $adversarial-review when that skill is available; otherwise follow this inline procedure directly. Before implementation, define the original requested outcome, acceptance criteria, affected code paths, and explicit non-goals. Obtain user approval before materially expanding the diff, crossing unrelated ownership boundaries, changing public APIs, or restructuring architecture. For each adversarial-review round, explicitly spawn exactly two independent, read-only subagents with fork_turns="none" so neither inherits the parent conversation or the other reviewer's analysis. Give each reviewer a self-contained brief with the exact worktree path, current HEAD SHA, comparison base SHA, original user-requested outcome, acceptance criteria, and explicit non-goals. Both must independently review the complete changes, including branch commits, staged and unstaged changes, and relevant untracked files, in that same worktree. Reviewers must not edit files, modify Git state, or spawn additional agents. If fresh-context subagents are unavailable, stop and report the limitation before pushing or updating the PR. Do not create separate Codex tasks or additional Git worktrees. Aggregate their findings and fix only supported issues introduced or worsened by the change, or narrowly necessary to achieve the requested outcome correctly and safely. Report unrelated preexisting defects, broader cleanup, and architectural improvements as separate follow-up recommendations; they must not expand the PR or prevent review convergence. Repeat with two newly spawned fresh-context reviewers per round until two consecutive rounds produce no meaningful, unresolved, in-scope blocking findings. Perform relevant testing and run applicable linters. If the change touches any security surfaces, perform a security review. Do not push or open/update a pull request before these checks are complete. If review has not converged after ten rounds, stop and report the remaining issues. Deeply scrutinize the requested change without expanding its scope.

## Task scope and review discipline

Before implementing or reviewing a change, identify the specific user-requested outcome and acceptance criteria, the code paths and tests reasonably necessary to achieve them, and explicit non-goals. Every changed file and behavior must be justified by that outcome, a regression introduced or worsened by the change, or a narrowly necessary prerequisite.

Do not fix unrelated preexisting bugs, modernize surrounding code, expand tests for unrelated behavior, redesign APIs, introduce general-purpose abstractions, or restructure neighboring modules merely because review uncovers an opportunity. Classify each finding as an introduced or worsened defect, a narrowly necessary correction, a preexisting unrelated problem, a broader improvement, or a serious concern that requires user agreement before proceeding. Fix only the first two categories in the current PR; report the next two separately without creating external issues or additional work unless requested, and stop for user agreement on the last.

Prefer the smallest coherent fix. If addressing feedback would substantially increase the diff, touch unrelated ownership boundaries, change public APIs, or require architectural restructuring, stop and request approval before expanding scope. Scope expansion is itself a code-quality regression. A clean review round has no unresolved, supported, in-scope blocking findings; out-of-scope observations never prevent convergence.

When writing or modifying tests - prefer code that satisfies the linter over adding inline lint suppressions. Never add a suppression when a straightforward compliant form exists; if a suppression is genuinely necessary, document why.

Prefer Vitest mocks or spies over ad-hoc test doubles when they exercise the real interface correctly. Verify that the mock matches the interface consumed by the code under test; otherwise use the smallest concrete implementation and explain the constraint in review feedback.

Treat customer issues as evidence of a problem, not as an approved implementation or API design. Before coding, compare the requested shape with the existing architecture, ownership boundaries, compatibility guarantees, idiomatic ecosystem tools, and the underlying user goal. If the proposed solution requires retrofitting a transport model into a validation/typing framework, splitting public accessor semantics from raw storage, repeatedly adding coercion special cases, or otherwise fighting established invariants, stop and propose a simpler design at the correct abstraction boundary instead. Use the existing TypeScript types and Zod schemas at the appropriate validation boundary rather than turning SDK transport models into a general-purpose modeling framework. Escalate substantive API/architecture tradeoffs for agreement before opening, expanding, or repeatedly re-pinging a PR; close or back out a PR when review establishes that its premise is wrong.

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
- For every new independent worktree or delegated implementation task, resolve the intended
  starting commit explicitly: use a user-specified commit/ref when provided,
  otherwise use the refreshed remote default branch. Record its full SHA before
  creating the worktree.
- Read-only reviewers sharing an existing worktree use the coordinator-provided
  current HEAD SHA as their intended checkout SHA, and the separately supplied
  comparison base to review the full change. They verify the current HEAD but
  do not select a new default-branch base, create a worktree, or modify Git state.
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
  task, inspect `git status --short`, `git diff --stat <intended-sha>`, and
  `git log --oneline <intended-sha>..HEAD`. Inspect untracked file contents and
  individual commit diffs as needed to confirm every changed file and inherited
  commit belongs to the assigned scope; an endpoint diff alone is insufficient.
- Never automatically reset, stash, rebase, switch, or discard changes in any
  other checkout.
<!-- codex-managed:worktree-policy:end -->

## Changesets and changelog entries

Add a `.changeset/*.md` release note when a change materially affects users of
the published `@openai/guardrails` package. Follow the
[release guide](.changeset/README.md) for examples and commands.

- Include user-facing features, bug fixes, API or type changes, breaking changes,
  deprecations, and meaningful runtime performance or security changes.
- Include dependency, build, or packaging changes when they affect what users
  install, supported environments, or package behavior. Judge the user impact,
  not just which files changed.
- Do not add entries for internal tooling, CI, release automation, tests,
  documentation-only edits, or refactoring with no user-visible effect.
- Describe the observable change and any action users need to take. Avoid
  internal implementation details that do not help package users.
- Commit the changeset with the code. Let Changesets generate `CHANGELOG.md`
  and version bumps through the release PR; do not edit them manually for an
  ordinary code change.

## Code review

During every code review, check whether the diff materially changes the published
package for end users. If it does, require a matching changeset before approval
and flag a missing or inaccurate entry as a review finding. Verify that the note
describes the user impact, covers migration steps when needed, and selects an
appropriate patch, minor, or major bump.

Do not request a changeset for internal-only changes listed above. Generated
release PRs consume changesets into the changelog; review their versions and
changelog rather than asking for another changeset.


## Repository map and supported tools

This repository publishes one package, `@openai/guardrails`, from `dist/`.
Use the owning module when changing a behavior:

| Area | Ownership |
| --- | --- |
| Public exports | `src/index.ts` and emitted declarations |
| OpenAI and Azure clients | `src/client.ts`, shared pipeline in `src/base-client.ts` |
| Chat Completions and Responses | `src/resources/`; preserve request parameters and options |
| Configuration and registration | `src/runtime.ts`, `src/spec.ts`, `src/registry.ts` |
| Built-in checks | `src/checks/` and shared schema/output helpers in `src/utils/` |
| Streaming output | `src/streaming.ts` and resource-specific stream handling |
| Agents integration | `src/agents.ts` and shared conversation normalization |
| Evaluation | `src/evals/` and `src/cli.ts` |
| Tests | `src/__tests__/unit/` and `src/__tests__/integration/` |
| Documentation | `docs/`, `docs/.vitepress/`, and `scripts/docs.test.mjs` |

Use [package.json](package.json) and the committed npm lockfile as the toolchain
source of truth. The current stack uses TypeScript 7, Vitest 4, Biome, and
VitePress. Node support is declared in `engines`; CI tests Node 22, 24, and 26.
The [SDK migration guide](docs/sdk_migration.md) documents the OpenAI 7,
Agents 0.17, and Zod 4 compatibility boundaries.

## Local verification

From the repository root, the full CI-equivalent sequence is:

```sh
npm ci
npm run build
npm run test:run
npm run lint
npm run docs:check
```

Run the commands one at a time and stop on failure. Build before the tests:
some SDK compatibility tests load the built CommonJS package and declarations.
`npm run lint` checks formatting and imports as well as lint rules with Biome;
a separate Prettier or ESLint installation is unnecessary. `npm run docs:check`
builds VitePress and checks generated documentation URLs using Node. Python,
MkDocs, uv, and Make are not required for these checks.

During implementation, use focused tests such as
`npm run test:run -- src/__tests__/unit/client.test.ts`. Run the full sequence
for runtime, dependencies, build, test, or packaging changes. For contributor
instructions and skill metadata only, validate the changed guidance, references,
and metadata and run `git diff --check`; unchanged runtime tests need not be
repeated. For site content, navigation, or documentation tooling changes, run
`npm run docs:check` after installing dependencies. A local docs check does not
publish the site.

Use the repository's current configuration when formatting changed supported
files. Biome does not cover Markdown or YAML here; review those formats and
links directly. Preserve existing checks, and report exactly which checks ran
and any failures or unavailable coverage. Release-note requirements are defined
above and in the [release guide](.changeset/README.md).
