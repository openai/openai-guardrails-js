---
"@openai/guardrails": patch
---

Honor `raiseGuardrailErrors` for output checks in streaming and non-streaming Chat Completions and Responses, for both OpenAI and Azure clients. Strict mode now propagates output-check execution errors; the default execution-error policy and genuine guardrail violation behavior remain unchanged. ([#103](https://github.com/openai/openai-guardrails-js/pull/103))
