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
  /** Conversation history as a direct property for convenient access */
  conversationHistory: NormalizedConversationEntry[];
  
  /** Get the full conversation history (method accessor for compatibility) */
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
        such as error details, matched patterns, or diagnostic messages. */
  info: {
    /** The processed/checked text when the guardrail modifies content */
    checked_text?: string;
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

/**
 * Token usage statistics emitted by LLM-based guardrails.
 */
export type TokenUsage = Readonly<{
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  unavailable_reason?: string | null;
}>;

/**
 * Aggregated token usage summary across multiple guardrails.
 */
export type TokenUsageSummary = Readonly<{
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}>;

type UsageRecord = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
};

const EMPTY_TOKEN_USAGE_SUMMARY: TokenUsageSummary = Object.freeze({
  prompt_tokens: null,
  completion_tokens: null,
  total_tokens: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(record: UsageRecord | null | undefined, keys: (keyof UsageRecord)[]): number | null {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const candidate = record[key];
    const numeric = readNumber(candidate);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

/**
 * Extract token usage data from an OpenAI API response object.
 */
export function extractTokenUsage(response: unknown): TokenUsage {
  const usage = (response as { usage?: UsageRecord | null })?.usage;
  if (!usage) {
    return Object.freeze({
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      unavailable_reason: 'Token usage not available for this model provider',
    }) as TokenUsage;
  }

  const promptTokens = pickNumber(usage, ['prompt_tokens', 'input_tokens']);
  const completionTokens = pickNumber(usage, ['completion_tokens', 'output_tokens']);
  const totalTokens = pickNumber(usage, ['total_tokens']);

  if (promptTokens === null && completionTokens === null && totalTokens === null) {
    return Object.freeze({
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      unavailable_reason: 'Token usage data not populated in response',
    }) as TokenUsage;
  }

  return Object.freeze({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  }) as TokenUsage;
}

/**
 * Convert a TokenUsage object into a plain dictionary suitable for serialization.
 */
export function tokenUsageToDict(tokenUsage: TokenUsage): TokenUsage {
  const result: Record<string, number | null> & { unavailable_reason?: string | null } = {
    prompt_tokens: tokenUsage.prompt_tokens,
    completion_tokens: tokenUsage.completion_tokens,
    total_tokens: tokenUsage.total_tokens,
  };

  if (tokenUsage.unavailable_reason !== undefined) {
    result.unavailable_reason = tokenUsage.unavailable_reason;
  }

  return Object.freeze(result) as TokenUsage;
}

/**
 * Aggregate token usage values from a collection of guardrail info dictionaries.
 */
export function aggregateTokenUsageFromInfos(
  infoDicts: Iterable<Record<string, unknown> | null | undefined>
): TokenUsageSummary {
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokens = 0;
  let hasData = false;

  for (const info of infoDicts) {
    if (!info) {
      continue;
    }

    const usage = info.token_usage;
    if (!isRecord(usage)) {
      continue;
    }

    const prompt = readNumber(usage.prompt_tokens);
    const completion = readNumber(usage.completion_tokens);
    const total = readNumber(usage.total_tokens);

    if (prompt === null && completion === null && total === null) {
      continue;
    }

    hasData = true;
    if (prompt !== null) {
      totalPrompt += prompt;
    }
    if (completion !== null) {
      totalCompletion += completion;
    }
    if (total !== null) {
      totalTokens += total;
    }
  }

  if (!hasData) {
    return EMPTY_TOKEN_USAGE_SUMMARY;
  }

  return Object.freeze({
    prompt_tokens: totalPrompt,
    completion_tokens: totalCompletion,
    total_tokens: totalTokens,
  }) as TokenUsageSummary;
}

const AGENT_RESULT_ATTRS = [
  'input_guardrail_results',
  'output_guardrail_results',
  'tool_input_guardrail_results',
  'tool_output_guardrail_results',
  'inputGuardrailResults',
  'outputGuardrailResults',
  'toolInputGuardrailResults',
  'toolOutputGuardrailResults',
] as const;

function extractAgentsSdkInfos(stageResults: unknown): Record<string, unknown>[] {
  if (!stageResults) {
    return [];
  }

  const entries: unknown[] = Array.isArray(stageResults)
    ? stageResults
    : isIterable(stageResults)
      ? Array.from(stageResults as Iterable<unknown>)
      : [];

  const infos: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const direct = entry.output_info ?? entry.outputInfo;
    if (isRecord(direct)) {
      infos.push(direct);
      continue;
    }

    const output = entry.output;
    if (isRecord(output)) {
      const nested = output.output_info ?? output.outputInfo;
      if (isRecord(nested)) {
        infos.push(nested);
      }
    }
  }

  return infos;
}

/**
 * Unified helper to compute total guardrail token usage from any result shape.
 */
export function totalGuardrailTokenUsage(result: unknown): TokenUsageSummary {
  if (!isRecord(result)) {
    return EMPTY_TOKEN_USAGE_SUMMARY;
  }

  const guardrailResults = result.guardrail_results ?? result.guardrailResults;
  if (isRecord(guardrailResults)) {
    const totals = (guardrailResults as { totalTokenUsage?: TokenUsageSummary }).totalTokenUsage;
    if (totals) {
      return totals;
    }
  }

  const directTotals = (result as { totalTokenUsage?: TokenUsageSummary }).totalTokenUsage;
  if (directTotals) {
    return directTotals;
  }

  const infos: Record<string, unknown>[] = [];
  for (const attr of AGENT_RESULT_ATTRS) {
    const stageResults = result[attr];
    if (stageResults) {
      infos.push(...extractAgentsSdkInfos(stageResults));
    }
  }

  if (infos.length === 0) {
    return EMPTY_TOKEN_USAGE_SUMMARY;
  }

  return aggregateTokenUsageFromInfos(infos);
}
