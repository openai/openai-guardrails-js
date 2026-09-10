---
"@openai/guardrails": patch
---

Run configured output guardrails on Responses streaming text for both OpenAI and Azure clients. Streaming text now reaches periodic and final output checks without duplicating text from completion snapshots. ([#101](https://github.com/openai/openai-guardrails-js/pull/101))
