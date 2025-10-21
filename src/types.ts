/**
 * Type definitions, interfaces, and result types for Guardrails.
 *
 * This module provides core types for implementing Guardrails, including:
 * - The `GuardrailResult` interface, representing the outcome of a guardrail check.
 * - The `CheckFn` interface, a callable interface for all guardrail functions.
 */

import { OpenAI } from 'openai';
import { NormalizedConversationEntry } from './utils/conversation';

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
 * Extended message type for conversation handling that includes additional properties
 * not present in the base Message type.
 */
export type ConversationMessage = NormalizedConversationEntry;

/**
 * Extended context interface for guardrails that need conversation history.
 *
 * This interface extends the base GuardrailLLMContext with methods for
 * accessing and managing conversation history, particularly useful for
 * prompt injection detection checks that need to track incremental conversation state.
 */
export interface GuardrailLLMContextWithHistory extends GuardrailLLMContext {
  /** Get the full conversation history */
  getConversationHistory(): NormalizedConversationEntry[];
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
    /** The media type this guardrail was designed for */
    media_type?: string;
    /** The detected content type of the input data */
    detected_content_type?: string;
    /** The stage where this guardrail was executed (pre_flight, input, output) */
    stage_name?: string;
    /** The name of the guardrail that produced this result */
    guardrail_name?: string;
    /** Additional guardrail-specific metadata */
    [key: string]: unknown;
  };
}

/**
 * Type alias for a guardrail function.
 *
 * A guardrail function accepts a context object, input data, and a configuration object,
 * returning either a `GuardrailResult` or a Promise resolving to `GuardrailResult`.
 */
export type CheckFn<TContext = object, TIn = TextInput, TCfg = object> = (
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
 * - TIn: TextInput (string input type for guardrails) // Future: Union type for different input types
 * - TCfg: object (any object, including interfaces and classes)
 */
export type TContext = object;
export type TIn = TextInput;
export type TCfg = object;

/**
 * Core message structure - clear and extensible.
 */
export type Message = {
  role: string;
  content: string | ContentPart[];
};

/**
 * Content part structure - clear and extensible.
 */
export type ContentPart = {
  type: string;
  [key: string]: unknown;
};

/**
 * Text content part for structured content (Responses API).
 */
export type TextContentPart = ContentPart & {
  type: 'input_text' | 'text' | 'output_text' | 'summary_text';
  text: string;
};


/**
 * Type alias for text-only input to guardrails.
 *
 * Currently represents string input for text-based guardrails. In the future,
 * this may be extended to support multi-modal content types (images, audio, video)
 * through a union type or more sophisticated content representation.
 */
export type TextInput = string;

/**
 * Text-only content types for guardrails.
 * These types enforce that only text content is processed.
 */

/** Plain text content */
export type TextContent = string;

/** Union type for all text-only content */
export type TextOnlyContent = TextContent | TextContentPart[];

/** Message with text-only content */
export type TextOnlyMessage = {
  role: string;
  content: TextOnlyContent;
};

/** Array of text-only messages */
export type TextOnlyMessageArray = TextOnlyMessage[];
