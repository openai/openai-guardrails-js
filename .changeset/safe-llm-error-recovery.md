---
'@openai/guardrails': patch
---

Prevent malformed provider errors from interrupting LLM guardrail error recovery. Preserve ordinary error messages and existing provider content-filter decisions when reporting failures.
