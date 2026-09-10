---
"@openai/guardrails": patch
---

Preserve plaintext PII findings when optional encoded analysis exceeds its decoded-size limit. Report incomplete analysis as a blocking tripwire so preflight checks do not continue under the default execution-error policy. ([#102](https://github.com/openai/openai-guardrails-js/pull/102))
