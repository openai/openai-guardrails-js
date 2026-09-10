---
'@openai/guardrails': patch
---

The URL Filter now rejects `http`, `https`, `ftp`, `data`, `javascript`, and
`vbscript` URL scheme prefixes containing embedded TAB, LF, or CR characters,
including when the destination is allowlisted. These ambiguous prefixes are
reported in `detected` and `blocked` with their original control characters.
Ordinary prose labels and scheme-like words inside existing URLs retain their
previous handling.
