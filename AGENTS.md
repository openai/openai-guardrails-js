# Contributor Guide

This guide helps contributors and coding agents work safely in the OpenAI Guardrails TypeScript repository. It defines the required repository skills, project boundaries, local verification, and handoff rules.

## Policies and mandatory rules

### Repository skills

Repository skills live under `.agents/skills/`. A reference such as `$<skill-name>` in this file is a repository instruction reference, not a request for manual user invocation. When a rule requires a skill, read `.agents/skills/<skill-name>/SKILL.md` completely before taking task actions, follow it, and resolve referenced files relative to that skill directory.

Only these repository skills are defined:

- `$code-change-verification`
- `$implementation-final-review`
- `$implementation-kickoff`
- `$implementation-strategy`
- `$pr-draft-summary`

#### `$code-change-verification`

Run `$code-change-verification` before marking work complete when the task changes runtime code, tests, examples, or build/test behavior.

Run it when changing:

- `src/` or `examples/`
- `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.eslintrc.js`, `.prettierrc`, or other build/test tooling

You may skip it for repo-meta changes and docs-only changes, including `AGENTS.md`, `.agents/`, `.github/`, `README.md`, `docs/`, `mkdocs.yml`, and `pyproject.toml`, unless the user explicitly asks for the full runtime verification stack or the docs change includes executable TypeScript behavior.

Treat this skill as the post-review final gate. When `$implementation-final-review` applies, satisfy its clean-review condition before starting the repository-wide install, build, lint, test, and format-check stack.

Immediately before starting that stack, use available read-only task or process evidence to check for another broad test, typecheck, build, docs build, example, or integration command already running on the same host. When concrete contention is visible, continue non-heavy work and defer the broad stack until capacity is available. Do not add a repository lock, host-wide mutex, sentinel file, or user-triggered `finalize` step. Lack of host telemetry alone is not a blocker.

#### `$implementation-strategy`

Before changing or reviewing runtime behavior, exported APIs, external configuration, persisted or serialized data, CLI behavior, provider forwarding, or other caller-visible behavior, use `$implementation-strategy` to establish the compatibility boundary and implementation shape.

Before coding, record a short implementation scope contract with:

1. Required behavior.
2. Compatibility requirements.
3. Intentionally unsupported cases and their failure behavior.
4. An existing supported alternative, or `none`.

Repeat the skill before editing a review-feedback batch that would widen the supported contract, add another compatibility branch, or multiply test permutations. Judge breaking changes against the latest released tag, not unreleased branch-local churn.

An independent reviewer dispatched by `$implementation-final-review` must not invoke `$implementation-strategy` again when the review packet already includes the complete scope contract, compatibility boundary, and resolved base. The implementer owns strategy decisions.

This exception does not apply to the implementer or to a reviewer asked to propose a widened contract.

#### `$implementation-final-review`

After implementing runtime code, tests, examples, build/test behavior, or behavior-impacting docs and completing focused checks, run `$implementation-final-review` before `$code-change-verification` and `$pr-draft-summary` and before declaring the task complete.

This repository instruction authorizes automatic invocation for eligible implementation work. Do not invoke it for planning, investigation, review-only work, repo-meta changes, or docs without behavior impact.

#### `$implementation-kickoff`

Use `$implementation-kickoff` only when the user explicitly invokes it. It authorizes the local worktree, branch, staging, commit, verification, and handoff workflow described by that skill. It never authorizes a push, pull-request creation, or any other GitHub mutation.

#### `$pr-draft-summary`

Before the final response, inspect the complete task diff. If it includes runtime code, tests, examples, build/test configuration, or behavior-impacting docs, invoke `$pr-draft-summary` after required review and verification.

Skip it when the diff is empty, every change is repo metadata or docs without behavior impact, the task is conversation-only, or the user explicitly opts out.

### GitHub and remote-state safety

- Never mutate GitHub. Do not push, create or edit pull requests or issues, post comments or reviews, change labels, merge, release, react, or alter remote branches.
- Never run `gh` on this machine. Use read-only GitHub access through another approved mechanism when remote evidence is required.
- Local branch creation and local commits require explicit user authorization. Fetching remote refs is read-only remote access but still changes local Git metadata; do it only when required by the task.
- Copy-ready GitHub text must use `#123` for this repository and `owner/repo#123` for another repository. Do not wrap native references in Markdown links or include local file links, Codex directives, or internal citations.

### Git worktree and branch safety

Use the user's selected checkout and current branch by default. Do not create or switch worktrees or branches unless the user explicitly requests or approves that action in the current conversation.

When isolation is authorized, preserve the source checkout and unrelated worktrees. Never remove, overwrite, or repurpose an existing worktree or branch to make room. Keep task-owned changes separate from user-owned changes.

### Work status

- Use `RUNNING` only in commentary while autonomous work remains and no user action is required.
- Use `COMPLETE` in the final response only when requested implementation, review, verification, and local handoff are complete.
- Use `NEEDS_DECISION` in the final response only when progress requires a concrete user choice, expanded authority, or unresolved external condition. State the exact condition instead of asking the user to say "continue".

### Scope discipline

- Implement the narrowest explicitly requested behavior.
- Prefer the existing owning pipeline over parallel validation, configuration, conversion, registry, streaming, or client-wrapper machinery.
- Map every new abstraction, state field, branch, dependency, and test category to the requirement, a released contract, a durable boundary, or a verified runtime risk.
- Treat a second related finding that adds another condition or permutation to the same abstraction as a complexity-reset signal. Re-read the requirement and replace branch-local machinery with a narrower design when the broader contract lacks evidence.
- Reject unsupported inputs before OpenAI requests, guardrail execution side effects, persistent writes, or externally visible mutation when practical.
- Keep unrelated cleanup and pre-existing failures out of the patch.

### Live API safety

Local unit tests and verification must not require a live OpenAI or Azure OpenAI request. Do not run live API examples, evals, benchmarks, or integration probes unless the user explicitly authorizes the exact live-service work and the applicable credential policy is satisfied. Never print or log credential values.

## Project structure

This repository contains one npm package, `@openai/guardrails`.

- `src/index.ts`: public package exports.
- `src/client.ts`: `GuardrailsOpenAI` and `GuardrailsAzureOpenAI` drop-in client wrappers.
- `src/base-client.ts`: shared pipeline execution, response wrapping, masking, context, and OpenAI resource forwarding.
- `src/resources/`: guardrail-aware Chat Completions and Responses resources.
- `src/runtime.ts`, `src/spec.ts`, and `src/registry.ts`: configuration loading, guardrail definitions, instantiation, and registry ownership.
- `src/checks/`: built-in guardrail implementations and registration.
- `src/streaming.ts`: streaming output checks and tripwire behavior.
- `src/agents.ts`: Agents SDK integration.
- `src/evals/`: evaluation CLI and reporting implementation.
- `src/utils/`: conversation, content, schema, output, safety identifier, and vector-store helpers.
- `src/__tests__/unit/`: unit tests.
- `src/__tests__/integration/`: integration-oriented tests; inspect for credential or external-service requirements before running directly.
- `examples/`: runnable examples, some of which may call live services.
- `docs/`: authored MkDocs documentation.
- `.github/workflows/ci.yml`: npm build, test, and lint CI contract.
- `package.json`, `package-lock.json`: npm scripts and locked JavaScript dependencies.
- `pyproject.toml`, `uv.lock`, `mkdocs.yml`: documentation toolchain and site configuration.

## Runtime and API guidelines

### Public package surface

- Keep `src/index.ts`, emitted declarations, package metadata, docs, and examples aligned for public API changes.
- Treat released exports, public types, constructor/factory arguments, configuration shapes, response augmentation, exception behavior, and CLI arguments as compatibility-sensitive.
- Compare compatibility against the latest `v*` release tag. Unreleased changes may be rewritten directly unless another supported durable consumer exists.

### OpenAI client wrappers

- Preserve drop-in behavior for both `GuardrailsOpenAI` and `GuardrailsAzureOpenAI` unless the task explicitly narrows one path.
- Keep Chat Completions and Responses behavior aligned where their OpenAI SDK contracts are equivalent.
- Forward request parameters and request options without dropping caller intent. Preserve the OpenAI SDK's omitted-value behavior instead of inventing defaults.
- Keep streaming and non-streaming behavior aligned for guardrail stage order, output extraction, tripwire suppression, errors, and attached `guardrail_results`.
- Do not let guardrail-only behavior unexpectedly replace or mutate unrelated OpenAI client resources.

### Guardrail execution and configuration

- Keep registry lookup, Zod configuration validation, guardrail instantiation, and execution ownership in their existing modules.
- Preserve the `pre_flight` -> `input` -> OpenAI request -> `output` lifecycle and ensure failures occur at the earliest correct side-effect boundary.
- Distinguish tripwire violations from guardrail execution failures. Preserve `raiseGuardrailErrors` and suppression semantics across direct clients, streams, and Agents SDK integration.
- Preserve conversation ordering, caller-provided history, tool-call identity, and text normalization when changing conversation or masking utilities.
- Treat configuration files, JSON input, eval datasets, and remote response content as untrusted input. Avoid leaking original sensitive values through errors, logs, result metadata, or fallback paths.

### Async lifecycle and streaming

- Trace ownership across every `await`, iterator step, callback, and error path when state, listeners, streams, or accumulated output are shared.
- Check partial initialization, request failure, stream failure, cancellation, tripwire interruption, and final output verification.
- Add controlled interleaving tests when stale work could overwrite or clean up state used by surviving work.
- Preserve the primary exception when cleanup also fails, and do not retain unnecessary provider exception graphs in public errors.

## Development workflow

### Prerequisites

- Node.js 18 or newer. CI currently uses Node.js 22.
- npm with the committed `package-lock.json`.
- Python 3.11 or newer plus `uv` for documentation work.

### Commands

Install dependencies from the repository root:

```bash
npm ci
```

Build TypeScript and declarations:

```bash
npm run build
```

Run focused tests during implementation:

```bash
npm run test:run -- src/__tests__/unit/<file>.test.ts
```

Run lint:

```bash
npm run lint
```

Run the full non-watch test suite:

```bash
npm run test:run
```

Run the complete required runtime stack through `$code-change-verification` when eligible. Do not use `npm test` for a final gate because it may enter watch mode in an interactive terminal.

### Tests

- Add or update unit tests for runtime changes unless genuinely infeasible; explain any omission.
- Prefer caller-visible assertions through exported or resource-facing behavior over tests that mirror private helper structure.
- For a bug fix, require a regression test that fails on the relevant base and passes with the patch when practical.
- Mock OpenAI/Azure network boundaries in unit tests. A mocked path proves implementation behavior, not realistic provider reach or user impact.
- Run integration tests or examples only after confirming they are local-only, or after explicit approval for any credentialed external request.

### Formatting and linting

- TypeScript and JavaScript formatting follows `.prettierrc`.
- Run Prettier on changed supported files before review. Verify idempotence when formatting can rewrite the diff.
- Keep TypeScript strictness intact. Do not suppress errors with broad `any`, unchecked assertions, or blanket lint disables when a narrow type is available.
- Comments should be complete sentences and end with punctuation.

## Documentation verification

Classify the complete task-owned docs diff by the highest applicable tier.

- **Editorial**: wording or formatting only, without changed technical meaning, links, anchors, snippets, navigation, or configuration. Run `git diff --check` and `npx prettier --check <changed Markdown files>`.
- **Content**: changed technical claims, API names, behavior, examples, links, or code snippets. Verify claims against source or an authoritative upstream contract, run Editorial checks, and run relevant TypeScript checks for executable snippets or examples.
- **Structural**: changed navigation, MkDocs configuration, docs build configuration, or generated site layout. Run Content checks plus `uv sync --frozen` and `uv run mkdocs build --site-dir site`.

Do not deploy docs as part of local verification. A docs build is not authorization to publish GitHub Pages.

## Commit and handoff guidelines

- Use Conventional Commit-style subjects where practical: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `build:`, or `ci:`.
- Keep the subject concise and imperative.
- Do not change the package version unless the task explicitly includes a release or version update.
- Stage only task-owned files. Inspect the staged diff and changed-path set before committing.
- Stop after local changes, verification, and any explicitly requested local commit. Do not push or open a pull request.

## Code review rules

Use `$implementation-strategy` to establish the required outcome and released compatibility boundary before judging architecture. Review the complete three-dot diff from the intended merge base, plus task-owned staged, unstaged, and untracked files.

### Finding threshold and supported scope

- Report a runtime defect only when the changed code causes concrete incorrect behavior on a supported path. State the triggering scenario and the caller-visible, compatibility, security, persistence, or lifecycle consequence.
- Treat added abstractions, validation, compatibility handling, fallbacks, dependencies, or parallel paths as actionable only when they do not map to the task, a released contract, supported durable state, or a verified runtime or platform risk. Recommend the smallest safe removal or direct replacement.
- Do not require SDK-owned validation for values already excluded by the public type contract or authoritatively rejected by the upstream provider unless delayed rejection creates a concrete Guardrails-owned problem before that rejection, such as an irreversible side effect, persistent corruption, sensitive-data exposure, avoidable billable work, or an unusably late error.
- Do not report a defect merely because another semantic choice is cleaner or more symmetric. Require a concrete inconsistency with supported behavior or an established caller-visible expectation.
- Flag a new public option, callback, class, compatibility branch, or execution path when the exact required outcome is already available through a reasonable supported API or composition path. Name that path and recommend narrower reuse.
- Report compatibility findings only against the latest released behavior, an explicitly supported contract, or a durable external state or protocol boundary. Do not require shims for unreleased branch-local helpers or intermediate formats.

### Contract and lifecycle coverage

- For every changed public field, configuration value, event, serialized value, or wire value, inspect supported construction, forwarding, adapter, and consumption paths. Flag normal, specialized, default, missing-value, or error paths that silently drop, reshape, or reject the value inconsistently.
- Require parity across OpenAI and Azure, Chat Completions and Responses, streaming and non-streaming, or direct and Agents SDK paths only when the accepted requirement or existing contract covers those paths.
- When changed code mutates shared state across an `await`, callback, retry, stream step, cancellation, cleanup, or rollback boundary, check whether stale or failing work can overwrite, revert, or dispose state owned by surviving work. Identify the concrete interleaving and missing ownership, generation, identity, transaction, revalidation, or serialization invariant.
- When a new validation or failure path runs after resources or observable state are acquired, verify cleanup and primary-failure preservation explicitly.
- Treat persisted, resumed, serialized, provider-controlled, or manifest data as untrusted unless the supported boundary grants it authority over host-owned runtime, security, identity, or cleanup decisions.

### Test and documentation evidence

- Treat tests as contract evidence only when they exercise the highest stable caller-visible boundary that controls the result and derive expectations from the requirement, released behavior, a worked example, a baseline, or another independent oracle.
- Require representative regression coverage for accepted behavior and one representative unsupported category. For concurrency, require controlled completion ordering and assertions about the surviving operation and final shared state.
- Report missing documentation or examples only when the patch makes existing guidance materially false, unsafe, or misleading; correct use depends on a non-obvious migration, compatibility boundary, constraint, or operational warning; or the accepted feature would otherwise be practically unusable.
- Passing tests do not establish product need, realistic provider behavior, or merge-worthiness by themselves. Do not report formatting, full-suite status, commit history, or pull-request description quality as code findings; those are repository-readiness conditions.

### Review scope

- Keep findings patch-scoped. Do not block on unrelated cleanup, pre-existing bugs, optional refactors, or speculative extensibility. A pre-existing condition is in scope only when the patch newly reaches it on a supported path or relies on it for correctness.
- Require broader refactoring only when the focused change would otherwise be incorrect, unsafe, incompatible, or dependent on duplicated sources of truth that can observably diverge.
- Check public export and declaration impact, credential and sensitive-data exposure, stage ordering, exception identity, conversation history, request-option forwarding, and registry/configuration ownership when those boundaries are touched.
- Do not speculate about contributor intent or AI authorship.
