---
name: code-change-verification
description: Select and run Guardrails verification for code, dependency, test, tooling, documentation, or repository-workflow changes.
---

# Code Change Verification

Follow [repository verification](../../../AGENTS.md#local-verification) and
inspect the current `package.json` scripts before selecting checks. Run from the
selected linked worktree's root; preserve its branch and user-owned changes.

## Select the evidence

| Changed area | Verification |
| --- | --- |
| Runtime, public types, dependencies, build/test configuration, packaging | Full sequence below; focused tests during implementation |
| SDK integration or dependency compatibility | Build first, then the relevant `src/__tests__/integration/sdk-*.test.ts` tests; full sequence before handoff |
| Site content, links, navigation, or VitePress tooling | `npm ci`, then `npm run docs:check` |
| Contributor instructions or skill metadata only | Validate commands, relative links, frontmatter/UI metadata, and `git diff --check` |

When areas overlap, combine their required checks. A test described as
"integration" is not necessarily live: inspect its fixtures and calls before
running it. The normal suite uses local fixtures and mocks; do not turn ordinary
verification into a credentialed eval or an external API experiment.

## Full sequence

Run each command separately and inspect its exit status before proceeding:

```sh
npm ci
npm run build
npm run test:run
npm run lint
npm run docs:check
```

The build emits CommonJS and declarations consumed by compatibility tests.
`test:run` avoids watch mode. Biome lint includes formatting and import checks;
VitePress and the Node documentation tests run through `docs:check`. Invoke npm
directly in the host shell, including PowerShell; no platform-specific wrapper
or additional formatter is needed.

Keep verification within the available sandbox. Diagnose failures and fix only
in-scope defects; report unrelated failures and missing coverage. Retry a
transient failure when evidence supports that diagnosis. After a fix, repeat
checks whose evidence it invalidated. Never report a skipped or failed gate as
passing, and do not infer Windows coverage from Linux or macOS results.

Report the command, result, tested Node version, and any coverage limits. For
remote checks, associate the result with the current PR head. The review gate
in AGENTS.md also applies before pushing; passing tests do not replace it.
