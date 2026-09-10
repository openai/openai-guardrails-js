---
"@openai/guardrails": minor
---

Upgrade to Agents SDK 0.17, OpenAI SDK 7, and Zod 4 together. Custom guardrail schemas must use Zod 4, and applications sharing OpenAI or Agents clients should upgrade those dependencies too. Exported schema definitions, validation errors, and inherited OpenAI APIs now follow their new upstream versions. See the SDK migration guide for native fetch, schema defaults, and inherited API changes.

Preserve built-in LLM output field instructions with Zod 4 and resolve Agents session history through the public SDK entry point, without relying on a hoisted agents-core package. Pipeline JSON and Guardrails factory entry points are unchanged.

Keep default PII entity lists independent across configurations, and preserve API-key callbacks for the separate client used by guardrail checks.

Keep Agents preflight checks blocking before model dispatch. Preserve provider and workload-identity authentication for guardrail calls, and retain initialized guardrails and client option overrides when using `withOptions()` on OpenAI or Azure clients.
