# Migrating to Agents 0.17, OpenAI 7, and Zod 4

Guardrails now depends on `@openai/agents ^0.17.2`, `openai ^7.9.0`, and
`zod ^4.5.4`. Upgrade these together if your application also installs them:

```bash
npm install @openai/guardrails @openai/agents@^0.17.2 openai@^7.9.0 zod@^4.5.4
```

The existing Node.js requirement, `^22.13.0 || >=24.0.0`, is unchanged.
Guardrails pipeline JSON and the `GuardrailAgent.create`, `GuardrailsOpenAI.create`,
and `GuardrailsAzureOpenAI.create` entry points remain unchanged.

## Custom guardrails and schemas

Use Zod 4 schemas for custom registry configuration, context requirements, and
LLM output models. Exported built-in schemas and their inferred types now use
Zod 4; Zod 3 schemas are no longer compatible with these interfaces. Replace
single-argument records such as `z.record(z.unknown())` with
`z.record(z.string(), z.unknown())`.

Zod 4 changes validation issue formats and some parsing behavior. Read errors
through `.issues`, rather than the removed `.errors` alias. Defaults are applied
inside optional properties; `.default()` returns a default without parsing it.
Use `.prefault()` if a custom schema must parse or transform its default.
See the [Zod migration guide](https://zod.dev/v4/changelog) for other changes.

`GuardrailSpec.schema()` still returns the underlying Zod definition, **not JSON
Schema**. Its contents now follow Zod 4 (`type` discriminators instead of Zod 3
`typeName` values). Consumers that inspect that definition must migrate too.

Built-in LLM checks use structured outputs for standard output schemas on the
official OpenAI GPT-4.1 models and their supported snapshots. Other models,
providers, and custom output schemas retain JSON-object mode. All responses are
validated locally. Custom fields in prompt instructions now use Zod 4 wrapper
handling, including preserving array field types.

## OpenAI and Azure clients

The wrapped clients, inherited SDK methods, constructor options, request options,
and response types now follow OpenAI 7. Applications passing their own OpenAI
client to a guardrail context should upgrade that client too.

OpenAI now uses native Web Fetch types: custom `fetch` implementations must return
Web `Response` objects, and SDK error headers use `Headers`. Replace `httpAgent`
configuration with supported `fetchOptions`. Azure-specific options still go to
`AzureOpenAI`; OpenAI-only provider routing options are not supported by Azure.

When using inherited SDK methods, migrate `beta.chat.completions` calls to
`chat.completions`, and check methods with multiple path parameters for the new
named-parameter shape. Consult the
[OpenAI migration guide](https://github.com/openai/openai-node/blob/main/MIGRATION.md)
for all inherited API changes. The Guardrails wrappers still expose their existing
`create` methods; this upgrade does not add guarded `parse` or other SDK methods.

OpenAI's `zodResponseFormat` helper supports Zod 4. Structured output schemas must
follow the API's required-field rules; use nullable fields for optional values.
Built-in checks use this helper for the structured-output cases described above.

## Agents integration

Upgrade your application's Agents SDK alongside Guardrails and use Zod 4 for
Agents tools and structured output. See the
[Agents SDK documentation](https://openai.github.io/openai-agents-js/) for changes
to directly used Agents APIs.

Guardrails resolves Runner and guardrail types through the public `@openai/agents`
entry point. Session-backed history no longer depends on npm hoisting the transitive
`@openai/agents-core` dependency. Input and output guardrails retain conversation
history when running the built CommonJS package with the matching Agents Runner.
