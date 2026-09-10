---
"@openai/guardrails": patch
---

Exclude system and developer messages from Jailbreak's conversation analysis to avoid treating application instructions as user jailbreak attempts. Multi-turn context is preserved for the remaining messages. Keep untrusted user input in user messages; text supplied directly to the check is still evaluated.
