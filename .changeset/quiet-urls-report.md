---
'@openai/guardrails': patch
---

The URL Filter now rejects `http`, `https`, `ftp`, `data`, `javascript`, and
`vbscript` scheme prefixes containing embedded TAB, LF, or CR characters,
including when the destination is allowlisted. These ambiguous prefixes are
reported in `detected` and `blocked` with their original control characters.
