---
"@openai/guardrails": patch
---

Fix preflight PII masking in Chat Completions and Responses to mask the intended user message when conversation history contains messages without text. ([#98](https://github.com/openai/openai-guardrails-js/pull/98))
