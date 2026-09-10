---
"@openai/guardrails": patch
---

Preserve explicit URL schemes during URL Filter extraction so configured scheme restrictions apply to the original URL. Independently validate bare URLs even when another URL uses the same host. ([#105](https://github.com/openai/openai-guardrails-js/pull/105))
