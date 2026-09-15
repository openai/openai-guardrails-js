---
'@openai/guardrails': patch
---

Allow `createOpenAIVectorStoreFromPath` to upload supported documents from directories whose names contain dots, such as `documents.v1`. Unsupported files remain excluded.
