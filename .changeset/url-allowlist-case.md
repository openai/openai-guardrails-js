---
"@openai/guardrails": patch
---

Fix URL allowlist matching to preserve case in paths, query strings, and fragments, so URLs must match the configured resource's case. Scheme and hostname matching remain case-insensitive. ([#99](https://github.com/openai/openai-guardrails-js/pull/99))
