# Types: TypeScript

Below are the core types used by the `@openai/guardrails` library.

## GuardrailLLMContext

```typescript
export interface GuardrailLLMContext {
  guardrailLlm: OpenAI;
}
```

Context interface providing access to the OpenAI client used by guardrails.

## GuardrailLLMContextWithHistory

```typescript
export interface GuardrailLLMContextWithHistory extends GuardrailLLMContext {
  getConversationHistory(): any[];
}
```

Extends the base context with helpers for conversation-history aware checks (e.g., prompt injection detection).

## GuardrailResult

```typescript
export interface GuardrailResult {
  tripwireTriggered: boolean;
  executionFailed?: boolean;
  originalException?: Error;
  info: {
    checked_text?: string;
    media_type?: string;
    detected_content_type?: string;
    stage_name?: string;
    guardrail_name?: string;
    [key: string]: unknown;
  };
}
```

Standard result returned by every guardrail check. The `executionFailed` field indicates if the guardrail itself failed to execute (e.g., invalid model name), and `originalException` contains the exception that caused the failure. These fields are used by the `raise_guardrail_errors` parameter to control error handling behavior.

## CheckFn

```typescript
export type CheckFn<TContext = object, TIn = TextInput, TCfg = object> =
  (ctx: TContext, input: TIn, config: TCfg) => GuardrailResult | Promise<GuardrailResult>;
```

Callable signature implemented by all guardrails. May be sync or async.

## Utility Types

```typescript
export type MaybeAwaitableResult = GuardrailResult | Promise<GuardrailResult>;
export type TContext = object;
export type TIn = TextInput;
export type TCfg = object;
```

For the full source, see [src/types.ts](https://github.com/openai/openai-guardrails-js/blob/main/src/types.ts) in the repository.
