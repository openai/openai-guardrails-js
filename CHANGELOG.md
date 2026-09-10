# @openai/guardrails

## 0.3.0

### Minor Changes

- a1b8172: Upgrade to Agents SDK 0.17, OpenAI SDK 7, and Zod 4 together. Custom guardrail schemas must use Zod 4, and applications sharing OpenAI or Agents clients should upgrade those dependencies too. Exported schema definitions, validation errors, and inherited OpenAI APIs now follow their new upstream versions. See the SDK migration guide for native fetch, schema defaults, and inherited API changes.

  Preserve built-in LLM output field instructions with Zod 4 and resolve Agents session history through the public SDK entry point, without relying on a hoisted agents-core package. Pipeline JSON and Guardrails factory entry points are unchanged.

  Keep default PII entity lists independent across configurations, and preserve API-key callbacks for the separate client used by guardrail checks.

  Keep Agents preflight checks blocking before model dispatch. Preserve provider and workload-identity authentication for guardrail calls, and retain initialized guardrails and client option overrides when using `withOptions()` on OpenAI or Azure clients.

- b247695: **Breaking change:** Require Node.js 22.13 or later in the 22.x series, or Node.js 24 or newer (`^22.13.0 || >=24.0.0`). Support for Node.js 18 and 20 is removed; Node.js 22.0–22.12 and 23 are also unsupported. Upgrade applications on unsupported versions before installing this release. ([#92](https://github.com/openai/openai-guardrails-js/pull/92), [#82](https://github.com/openai/openai-guardrails-js/pull/82))
- b247695: Allow passing per-request OpenAI options to responses and chat completion create methods. ([#63](https://github.com/openai/openai-guardrails-js/pull/63))

### Patch Changes

- b247695: Preserve explicit URL schemes during URL Filter extraction so configured scheme restrictions apply to the original URL. Independently validate bare URLs even when another URL uses the same host. ([#105](https://github.com/openai/openai-guardrails-js/pull/105))
- 08a5d02: Exclude system and developer messages from Jailbreak's conversation analysis to avoid treating application instructions as user jailbreak attempts. Multi-turn context is preserved for the remaining messages. Keep untrusted user input in user messages; text supplied directly to the check is still evaluated.
- b247695: Fix false positives in Finnish personal identity code detection that could incorrectly mask or block non-PII text. ([#88](https://github.com/openai/openai-guardrails-js/pull/88))
- b247695: Enforce configured path, query, and fragment restrictions for full IPv4 URL allowlist entries. Bare IP and CIDR entries retain their host-wide matching behavior. ([#100](https://github.com/openai/openai-guardrails-js/pull/100))
- b247695: Prevent excessive processing time when LLM-based guardrails check long system prompts for existing JSON output instructions. ([#85](https://github.com/openai/openai-guardrails-js/pull/85))
- b247695: Prevent excessive processing time for Keyword Filter and Competitors configurations containing long keywords with trailing punctuation, without changing matching behavior. ([#84](https://github.com/openai/openai-guardrails-js/pull/84))
- b247695: Honor `raiseGuardrailErrors` for output checks in streaming and non-streaming Chat Completions and Responses, for both OpenAI and Azure clients. Strict mode now propagates output-check execution errors; the default execution-error policy and genuine guardrail violation behavior remain unchanged. ([#103](https://github.com/openai/openai-guardrails-js/pull/103))
- b247695: Preserve plaintext PII findings when optional encoded analysis exceeds its decoded-size limit. Report incomplete analysis as a blocking tripwire so preflight checks do not continue under the default execution-error policy. ([#102](https://github.com/openai/openai-guardrails-js/pull/102))
- b247695: Fix preflight PII masking in Chat Completions and Responses to mask the intended user message when conversation history contains messages without text. ([#98](https://github.com/openai/openai-guardrails-js/pull/98))
- b34480c: Use Structured Outputs for standard LLM guardrail results on OpenAI's GPT-4.1,
  GPT-4.1 mini, and GPT-4.1 nano models, including their 2025-04-14 snapshots, to
  require the decision and confidence fields even for benign input. Reasoning is
  required when enabled. Other models, providers, and custom output schemas retain
  their existing JSON mode behavior.

  Prevent validation-error logging from invoking Node's exception object inspector
  so that guardrail execution failures retain their diagnostics and token usage.

  The minimum dependency versions are now OpenAI SDK 4.55.0 and Zod 3.23.8. Update
  dependency overrides or resolutions that pin older versions.

- 7c88658: Preserve LLM guardrail error results and available token usage when console logging throws, including when Node.js cannot inspect a validation error.
- 6c13ba0: Make LOCATION PII matching run in linear time while preserving street-address detection and masking for plaintext and decoded content.
- d8ff905: The URL Filter now rejects `http`, `https`, `ftp`, `data`, `javascript`, and
  `vbscript` URL scheme prefixes containing embedded TAB, LF, or CR characters,
  including when the destination is allowlisted. These ambiguous prefixes are
  reported in `detected` and `blocked` with their original control characters.
  Ordinary prose labels and scheme-like words inside existing URLs retain their
  previous handling.
- aa0f374: Preserve the latest user goal when limiting prompt injection detection history, so recent tool actions are still analyzed with small `max_turns` windows, including single-turn mode. Older context remains bounded and no configuration changes are required.
- b247695: Run configured output guardrails on Responses streaming text for both OpenAI and Azure clients. Streaming text now reaches periodic and final output checks without duplicating text from completion snapshots. ([#101](https://github.com/openai/openai-guardrails-js/pull/101))
- 2480b7c: Prevent malformed provider errors from interrupting LLM guardrail error recovery. Preserve ordinary error messages and existing provider content-filter decisions when reporting failures.
- b247695: Fix provider detection so custom endpoints are not incorrectly treated as supporting OpenAI's `safety_identifier` parameter. ([#87](https://github.com/openai/openai-guardrails-js/pull/87))
- b247695: Prevent excessive processing time when the Secret Keys guardrail checks URL-like text, while preserving existing secret detection behavior. ([#86](https://github.com/openai/openai-guardrails-js/pull/86))
- b247695: Fix URL allowlist matching to preserve case in paths, query strings, and fragments, so URLs must match the configured resource's case. Scheme and hostname matching remain case-insensitive. ([#99](https://github.com/openai/openai-guardrails-js/pull/99))
- 46f16ba: Validate every Chat completion choice independently, including streamed alternatives, with concurrent output checks. Preserve ordered final results and strict execution-error handling. Multi-choice streams now return final validation results even when tripwire exceptions are suppressed.
