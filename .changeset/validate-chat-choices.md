---
"@openai/guardrails": patch
---

Validate every Chat completion choice independently, including streamed alternatives, with concurrent output checks. Preserve ordered final results and strict execution-error handling. Multi-choice streams now return final validation results even when tripwire exceptions are suppressed.
