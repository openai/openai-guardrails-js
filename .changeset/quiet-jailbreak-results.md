---
"@openai/guardrails": patch
---

Use Structured Outputs for standard LLM guardrail results on OpenAI's GPT-4.1,
GPT-4.1 mini, and GPT-4.1 nano models, including their 2025-04-14 snapshots, to
require the decision and confidence fields even for benign input. Reasoning is
required when enabled. Other models, providers, and custom output schemas retain
their existing JSON mode behavior.

Prevent validation-error logging from invoking Node's exception object inspector
so that guardrail execution failures retain their diagnostics and token usage.

The minimum dependency versions are now OpenAI SDK 4.55.0 and Zod 3.23.8. Update
dependency overrides or resolutions that pin older versions.
