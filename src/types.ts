/**
 * Type definitions, interfaces, and result types for Guardrails.
 *
 * This module provides core types for implementing Guardrails, including:
 * - The `GuardrailResult` interface, representing the outcome of a guardrail check.
 * - The `CheckFn` interface, a callable interface for all guardrail functions.
 */

import { OpenAI } from 'openai';

/**
 * Interface for context types providing an OpenAI client.
 *
 * Classes implementing this interface must expose an `OpenAI`
 * client via the `guardrailLlm` property.
 */
export interface GuardrailLLMContext {
  /** The OpenAI client used by the guardrail. */
  guardrailLlm: OpenAI;
}

/**
 * Extended context interface for guardrails that need conversation history.
 *
 * This interface extends the base GuardrailLLMContext with methods for
 * accessing and managing conversation history, particularly useful for
 * prompt injection detection checks that need to track incremental conversation state.
 */
export interface GuardrailLLMContextWithHistory extends GuardrailLLMContext {
  /** Get the full conversation history */
  getConversationHistory(): any[];
}

/**
 * Result returned from a guardrail check.
 *
 * This interface encapsulates the outcome of a guardrail function,
 * including whether a tripwire was triggered, execution failure status,
 * and any supplementary metadata.
 */
export interface GuardrailResult {
  /** True if the guardrail identified a critical failure. */
  tripwireTriggered: boolean;
  /** True if the guardrail failed to execute properly. */
  executionFailed?: boolean;
  /** The original exception if execution failed. */
  originalException?: Error;
  /** Additional structured data about the check result,
        such as error details, matched patterns, or diagnostic messages.
        Must include checked_text field containing the processed text. */
  info: {
    /** The processed/checked text that should be used if modifications were made */
    checked_text: string;
    /** Additional guardrail-specific metadata */
    [key: string]: any;
  };
}

/**
 * Type alias for a guardrail function.
 *
 * A guardrail function accepts a context object, input data, and a configuration object,
 * returning either a `GuardrailResult` or a Promise resolving to `GuardrailResult`.
 */
export type CheckFn<TContext = object, TIn = unknown, TCfg = object> = (
  ctx: TContext,
  input: TIn,
  config: TCfg
) => GuardrailResult | Promise<GuardrailResult>;

/**
 * Generic type for a guardrail function that may be async or sync.
 */
export type MaybeAwaitableResult = GuardrailResult | Promise<GuardrailResult>;

/**
 * Type variables for generic guardrail functions.
 *
 * These provide sensible defaults while allowing for more specific types:
 * - TContext: object (any object, including interfaces)
 * - TIn: unknown (any input type, most flexible)
 * - TCfg: object (any object, including interfaces and classes)
 */
export type TContext = object;
export type TIn = unknown;
export type TCfg = object;
