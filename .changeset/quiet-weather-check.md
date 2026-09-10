---
'@openai/guardrails': patch
---

Preserve the latest user goal when limiting prompt injection detection history, so recent tool actions are still analyzed with small `max_turns` windows, including single-turn mode. Older context remains bounded and no configuration changes are required.
