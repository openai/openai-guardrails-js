# Migrating to Agents 0.17, OpenAI 7, and Zod 4

This guide covers upgrading `@openai/guardrails` from 0.2.1 to 0.3.0.
The release introduces breaking dependency and runtime changes:

| Dependency | In 0.2.1 | Required by 0.3.0 |
| --- | --- | --- |
| Node.js | `>=18.0.0` | `^22.13.0 \|\| >=24.0.0` |
| `zod` | `^3.22.0` | `^4.5.4` |
| `openai` | `^4.0.0` | `^7.9.0` |
| `@openai/agents` | `^0.1.3` | `^0.17.2` |

## Quick upgrade

1. Upgrade local, CI, and production Node.js runtimes to 22.13+ in the 22.x
   series, or 24+. Node.js 18, 20, 22.0–22.12, and 23 are no longer supported.
2. Once 0.3.0 is published, install it and update any of these SDKs your app
   directly uses. For an app that uses all three:

   ```bash
   npm install @openai/guardrails@^0.3.0 @openai/agents@^0.17.2 openai@^7.9.0 zod@^4.5.4
   ```

   If your app only imports Guardrails, install `@openai/guardrails@^0.3.0`;
   its SDK dependencies are installed transitively. Update any dependency
   overrides or resolutions that force older versions, and commit the updated
   manifest and lockfile.
3. Migrate custom Zod schemas, shared OpenAI clients, and Agents tools using the
   sections below. Do not pass Zod 3 schemas or older SDK clients into Guardrails.
4. Run your application's TypeScript build and tests. Exercise custom schema
   validation (including defaults and errors), custom fetch or proxy options,
   and Agents runs with session history if your app uses them. Check installed
   versions with `npm ls @openai/guardrails @openai/agents openai zod`.

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

The separate client used for guardrail checks retains SDK provider and workload-identity
authentication. `withOptions()` returns an initialized guarded client with the requested
SDK option overrides, including for Azure clients.

## Agents integration

Upgrade your application's Agents SDK alongside Guardrails and use Zod 4 for
Agents tools and structured output. See the
[Agents SDK documentation](https://openai.github.io/openai-agents-js/) for changes
to directly used Agents APIs.

Guardrails resolves Runner and guardrail types through the public `@openai/agents`
entry point. Session-backed history no longer depends on npm hoisting the transitive
`@openai/agents-core` dependency. Input and output guardrails retain conversation
history when running the built CommonJS package with the matching Agents Runner.

Generated `pre_flight` guardrails explicitly block model dispatch until they pass.
The `input` stage retains the Agents SDK default execution behavior.
