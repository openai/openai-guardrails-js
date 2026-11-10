# Repository instructions

Monitor PR CI. Fix only introduced/worsened failures or narrowly necessary
corrections; report unrelated failures and retry transient/flaky checks when
appropriate. For feedback fixes, push, explain the correction in the review comment,
then resolve it.

## Task scope and review discipline

Before implementation/review, define the requested outcome, acceptance criteria,
affected paths/tests, and non-goals. Justify every changed file and behavior.
Classify findings: (1) introduced/worsened defect, (2) narrowly necessary
correction, (3) unrelated preexisting defect, (4) broader improvement, or
(5) serious concern requiring agreement. Fix only 1–2; report 3–4 separately
without creating issues or extra work; stop for user agreement on 5.

Prefer the smallest coherent fix. Obtain approval before material scope growth,
unrelated ownership changes, public API changes, or architectural restructuring.
Do not add unrelated fixes, modernization, tests, abstractions, or redesigns.
Out-of-scope observations never block review convergence.

Customer issues are problem evidence, not approved designs. Compare proposals
with existing architecture, ownership, compatibility, idiomatic tools, and the
user's goal. If a design retrofits transport models into validation/typing,
splits public accessors from raw storage, repeatedly adds coercion special cases,
or fights established invariants, stop and propose a simpler design at the owning
boundary. Use TypeScript types and Zod schemas at their validation boundary;
do not turn SDK transport models into a modeling framework. Agree substantive
API/architecture tradeoffs before opening, expanding, or repeatedly re-pinging
a PR; close/back out a PR whose premise review establishes is wrong.

Prefer lint-compliant tests over suppressions; document unavoidable suppressions.
Prefer Vitest mocks/spies that match the consumed interface. Otherwise use the
smallest concrete implementation and explain the constraint in review feedback.

## Adversarial review

Before every push or PR creation/update, use `$adversarial-review` when available;
otherwise follow this procedure:

1. Spawn exactly two new independent read-only subagents per round with
   `fork_turns="none"`. Give each a self-contained brief: exact shared worktree,
   HEAD, comparison base, original outcome, acceptance criteria, and non-goals.
   Both review the complete change: branch commits, staged/unstaged changes,
   and relevant untracked files. Neither may edit, modify Git, spawn agents,
   inherit the parent conversation, or see the other's analysis. Do not create
   separate tasks or additional reviewer worktrees. If fresh-context subagents
   are unavailable, stop before pushing/updating the PR and report it.
2. Aggregate findings; fix only scope categories 1–2 above. Repeat with a fresh
   pair until two consecutive rounds have no meaningful, supported, unresolved,
   in-scope blockers. Stop and report remaining issues after ten rounds.
3. Run applicable tests/linters and review touched security surfaces. Complete
   all checks before pushing or opening/updating the PR.

Use the [final-review brief and workflow](.agents/skills/implementation-final-review/SKILL.md)
for dispatch and evidence; scrutinize the full change without expanding scope.

## Credentials and sensitive data

- Never commit, print, or log live credentials; use synthetic placeholders in
  fixtures, examples, snapshots, issues, PRs, and review comments.
- Redact authorization headers, credentials, customer data, and sensitive
  request/response content from shared logs/reproductions. Inspect artifacts
  and diffs before upload.
- Use approved secret storage and scoped credentials for authorized tasks;
  never extract credentials from local configuration or broaden CI permissions
  to bypass an access failure.
- On exposure, stop reproducing/sharing the credential and privately notify its
  owner for revocation/rotation. Report vulnerabilities through
  [SECURITY.md](SECURITY.md), without live credentials or sensitive logs.

<!-- codex-managed:worktree-policy:start -->
## Git worktree isolation and default-branch freshness

- Modify repositories only in linked worktrees, never the primary checkout.
  If started in primary, stop and ask to start/handoff to a worktree; only
  deliberately requested checkout maintenance is exempt.
- Reserve primary for the default branch (`origin/HEAD`, then `main`/`master`).
  Refresh stale origin refs at session start. Fast-forward primary only when
  clean, on that branch, without history rewriting or a merge commit.
- Before each independent worktree/delegated implementation, record the exact
  intended SHA: user-selected ref, otherwise refreshed remote default. Verify
  trunk-based starts are current with `origin/main`/`origin/master`; a clean
  detached worktree may fast-forward before edits. Preserve intentional feature
  branches and existing work.
- Ref tips must equal the intended SHA; containment is insufficient. Never
  substitute an unrelated feature branch. Feature/stack bases require explicit
  user request. If task creation accepts only branches and default is stale,
  safely fast-forward clean primary or create a dedicated exact-SHA base branch;
  otherwise stop.
- Immediately after receiving/creating the worktree, require `git rev-parse HEAD`
  to equal the recorded SHA and `git rev-list --left-right --count <sha>...HEAD`
  to report `0 0`; stop before editing on mismatch. Prompts, containment, and
  detached HEAD are not proof. Read-only reviewers verify the coordinator's
  HEAD and use its separate comparison base; they do not choose a new base,
  create worktrees, or modify Git.
- Before reporting, committing, or opening an independent PR, inspect
  `git status --short`, `git diff --stat <sha>`, and
  `git log --oneline <sha>..HEAD`; inspect untracked contents and individual
  commits as needed to prove all changes/inherited commits are in scope.
  Endpoint diffs alone are insufficient.
- Never automatically reset, stash, rebase, switch, or discard another
  checkout's changes.
<!-- codex-managed:worktree-policy:end -->

## Changesets and changelog entries

Follow the [release guide](.changeset/README.md#contributing-a-release-note):
commit changesets for material package-user impact, not internal-only changes.
Describe observable behavior and migration actions. Let Changesets generate
`CHANGELOG.md` and version bumps through the release PR; never edit them manually
for ordinary changes.

## Code review

Every review must assess package-user impact and require an accurate changeset
with appropriate bump/migration guidance when applicable. Follow the release
guide's exclusions; review generated release versions/changelog rather than
requesting another changeset.

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
source of truth. Node support is declared in `engines`; check CI for its test matrix.
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


## Repository skills

Use these skills when their described task applies. The repository policies
above remain authoritative; skills do not expand the user's scope or authorize
external actions on their own.

- [code-change-verification](.agents/skills/code-change-verification/SKILL.md): Verify changes with the current npm toolchain.
- [implementation-strategy](.agents/skills/implementation-strategy/SKILL.md): Choose scope around existing Guardrails boundaries.
- [implementation-final-review](.agents/skills/implementation-final-review/SKILL.md): Review complete changes with independent reviewers.
- [implementation-kickoff](.agents/skills/implementation-kickoff/SKILL.md): Start bounded implementation and PR takeover work.
- [pr-draft-summary](.agents/skills/pr-draft-summary/SKILL.md): Draft PRs and follow current-head CI and reviews.
