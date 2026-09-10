---
name: implementation-strategy
description: Choose bounded implementation scope and existing owning modules before Guardrails runtime, configuration, client, resource, streaming, Agents, or SDK compatibility changes and feedback fixes.
---

# Implementation Strategy

Before implementation or a feedback fix, record the requested outcome,
acceptance criteria, affected paths, compatibility requirements, and non-goals.
Apply [scope discipline](../../../AGENTS.md#task-scope-and-review-discipline).
An issue's suggested implementation is evidence, not an approved API design.

## Find the owning boundary

Read the [repository map](../../../AGENTS.md#repository-map-and-supported-tools)
and [SDK migration guide](../../../docs/sdk_migration.md). Use existing
configuration, validation, registry, conversation, and resource pipelines.
Identify whether the affected contract is a public export, declaration,
configuration format, request/response shape, exception, CLI option, or internal
helper. Compare ownership changes against the intended PR base; consult a
verified release tag separately when evaluating released compatibility. Report
an unavailable or stale release baseline rather than treating branch-only
behavior as a released guarantee.

| Boundary | Preserve and inspect |
| --- | --- |
| OpenAI/Azure clients | Async create factories, separate check client, caller options and credentials, and initialized guarded clones from `withOptions()` |
| Resources | Chat/Responses parameters and request options, SDK-compatible types, and the explicit `guardrails` namespace; do not imply every inherited SDK method is guarded |
| OpenAI 7 | Native Fetch `Response`/`Headers`, provider-specific options, and inherited SDK method contracts |
| Zod 4 | Existing schemas and their owning validation boundary; `GuardrailSpec.schema()` returns the definition, not JSON Schema |
| Agents | Public `@openai/agents` imports, built CommonJS behavior, session history, and preflight guards blocking model dispatch |
| Pipeline | `pre_flight`, `input`, `output` ordering and each integration's documented execution model; distinguish tripwires from execution errors |
| Streaming and history | Resource-specific output checks, conversation ordering and roles, tool-call identity, masking, and output error policy |

Do not add new guarded SDK methods, normalize omitted options into arbitrary
defaults, or duplicate schema/conversation conversion just to accommodate a
suggested implementation. Escalate a substantive public API or architecture
change before expanding the diff.

## Match tests to the changed contract

Use existing unit tests beside the owning area. For SDK boundaries, inspect
`src/__tests__/integration/sdk-compat.test.ts`, `sdk-types.test.ts`, and
`sdk-migration-feedback.test.ts`: they cover built-package behavior and consumer
types that source-only mocks can miss. Build before running these tests. Use
Vitest mocks/spies or SDK-provided testing utilities where they model the real
protocol. Add only tests needed for the changed behavior.

For a touched security surface, review the relevant trust boundary: untrusted
configuration, provider responses, conversation content, or eval inputs, and
where validation occurs before side effects. Keep this review scoped to the
change; do not convert it into unrelated hardening.

Classify feedback using AGENTS.md. Fix introduced/worsened defects and narrowly
necessary corrections. Record broader improvements separately. If repeated
special cases suggest the approach fights an existing invariant, revisit the
smallest design at the owning boundary before adding more machinery.

Use [code-change-verification](../code-change-verification/SKILL.md) for checks
and the [release guide](../../../.changeset/README.md) for changeset impact.
