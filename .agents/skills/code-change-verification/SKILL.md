---
name: code-change-verification
description: Run the mandatory verification stack when changes affect runtime code, tests, examples, or build/test behavior in openai-guardrails-js.
---

# Code Change Verification

## Overview

Ensure work is only marked complete after the locked npm install, TypeScript build and declaration emission, lint, non-watch tests, and formatting check pass. Use this skill when changes affect runtime code, tests, examples, or build/test configuration. This is a post-review final gate: when `$implementation-final-review` applies, do not invoke the broad stack until its clean-review condition applies to the stable task diff.

## Quick start

1. Keep this skill at `./.agents/skills/code-change-verification` so it loads automatically for the repository.
2. Run the skill in the user's selected checkout without changing worktrees or branches.
3. Codex on macOS/Linux: `/usr/bin/env -u OPENAI_API_KEY bash .agents/skills/code-change-verification/scripts/run.sh`.
4. Other macOS/Linux environments: `bash .agents/skills/code-change-verification/scripts/run.sh`.
5. Windows: `powershell -ExecutionPolicy Bypass -File .agents/skills/code-change-verification/scripts/run.ps1`.
6. If any command fails, fix the issue, rerun the script, and report the failing output.
7. Confirm completion only when all commands succeed with no remaining issues.

## Start condition and host capacity

- During iterative review, use only focused tests and a narrowly targeted TypeScript check when the changed typing boundary requires one. Defer the complete npm stack until review is clean.
- Immediately before starting the complete stack, use available read-only task or process evidence to check whether another repository-wide test, typecheck, build, examples runner, or integration command is already active on the same host.
- When concrete contention is visible, continue useful non-heavy work such as review, remediation, evidence preparation, or focused checks, then check again later. Do not create or wait on a repository lock, host-wide mutex, or sentinel file.
- Start automatically once review is clean, the diff is stable, and observable host capacity is available. Do not require a user-triggered `finalize` message. If host telemetry is unavailable, do not block solely because capacity cannot be measured.

## Codex execution policy

Repository verification and all child processes must remain in the normal Codex workspace sandbox. Never request elevated sandbox permissions for verification, and never retry with broader host access after a failure.

On macOS/Linux, use the exact Codex command from Quick start so an inherited `OPENAI_API_KEY` is removed before the repository-controlled wrapper starts. Investigate failures inside the workspace sandbox and report any coverage that the sandbox cannot provide instead of weakening the sandbox boundary.

## Manual workflow

- Run from the repository root in this order: `npm ci`, `npm run build`, `npm run lint`, `npm run test:run`, and `npm exec -- prettier --check "**/*.{cjs,cts,js,json,mjs,mts,ts}"`.
- `npm run build` is the repository typecheck and declaration-emission gate.
- Do not skip steps; stop and fix issues immediately when any step fails.
- Re-run the full stack after applying fixes so the commands execute with the same barriers and coverage.
- Do not substitute `npm test` for `npm run test:run`; the former can enter watch mode in an interactive terminal.

## Resources

### scripts/run.sh

- Executes the full verification sequence, including declaration emission, with fail-fast semantics.
- Keeps `npm ci` and `npm run build` as barriers before lint, tests, and format checking.
- Prefer this entry point to ensure the commands always run from the repo root with the expected fail-fast behavior.

### scripts/run.ps1

- Windows-friendly wrapper that runs the same verification sequence with fail-fast semantics.
- Use from PowerShell with execution policy bypass if required by your environment.
