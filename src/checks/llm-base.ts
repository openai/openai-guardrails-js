/**
 * LLM-based guardrail content checking.
 *
 * This module enables the creation and registration of content moderation guardrails
 * using Large Language Models (LLMs). It provides configuration and output schemas,
 * prompt helpers, a utility for executing LLM-based checks, and a factory for generating
 * guardrail check functions leveraging LLMs.
 */

import { z, ZodTypeAny } from 'zod';
import { OpenAI } from 'openai';
import {
  CheckFn,
  GuardrailResult,
  GuardrailLLMContext,
  TokenUsage,
  extractTokenUsage,
  tokenUsageToDict,
} from '../types';
import { defaultSpecRegistry } from '../registry';
import { SAFETY_IDENTIFIER, supportsSafetyIdentifier } from '../utils/safety-identifier';

/**
 * Configuration schema for LLM-based content checks.
 *
 * Used to specify the LLM model and confidence threshold for triggering a tripwire.
 */
export const LLMConfig = z.object({
  /** The LLM model to use for checking the text */
  model: z.string().describe('LLM model to use for checking the text'),
  /** Minimum confidence required to trigger the guardrail, as a float between 0.0 and 1.0 */
  confidence_threshold: z
    .number()
    .min(0.0)
    .max(1.0)
    .default(0.7)
    .describe(
      'Minimum confidence threshold to trigger the guardrail (0.0 to 1.0). Defaults to 0.7.'
    ),
  /** Optional system prompt details for user-defined LLM guardrails */
  system_prompt_details: z.string().optional().describe('Additional system prompt details'),
  /**
   * Whether to include reasoning/explanation in guardrail output.
   * Useful for development and debugging, but disabled by default in production to save tokens.
   */
  include_reasoning: z
    .boolean()
    .default(false)
    .describe(
      'Whether to include reasoning/explanation fields in the output. Defaults to false to minimize token costs.'
    ),
});

export type LLMConfig = z.infer<typeof LLMConfig>;

/**
 * Output schema for LLM content checks.
 *
 * Used for structured results returned by LLM-based moderation guardrails.
 */
export const LLMOutput = z.object({
  /** Indicates whether the content was flagged */
  flagged: z.boolean(),
  /** LLM's confidence in the flagging decision (0.0 to 1.0) */
  confidence: z.number().min(0.0).max(1.0),
});

export type LLMOutput = z.infer<typeof LLMOutput>;

/**
 * Extended LLM output schema with reasoning.
 *
 * Extends LLMOutput to include a reason field explaining the decision.
 * Used when include_reasoning is enabled in the config.
 */
export const LLMReasoningOutput = LLMOutput.extend({
  /** Explanation of the guardrail decision */
  reason: z.string(),
});

export type LLMReasoningOutput = z.infer<typeof LLMReasoningOutput>;

/**
 * Extended LLM output schema with error information.
 *
 * Extends LLMOutput to include additional information about errors that occurred
 * during LLM processing, such as content filter triggers.
 */
export const LLMErrorOutput = LLMOutput.extend({
  /** Additional information about the error */
  info: z.record(z.string(), z.any()),
});

export type LLMErrorOutput = z.infer<typeof LLMErrorOutput>;

/**
 * Create a standardized error result for LLM-based guardrails.
 *
 * This helper provides a consistent way to handle errors across all LLM-based checks,
 * ensuring uniform error reporting and preventing tripwire triggers on execution failures.
 * Sets executionFailed=true to enable raiseGuardrailErrors handling.
 *
 * @param guardrailName - Name of the guardrail that encountered the error.
 * @param analysis - LLMErrorOutput containing error information.
 * @param additionalInfo - Optional additional information to include in the result.
 * @returns GuardrailResult with tripwireTriggered=false, executionFailed=true, and error information.
 */
export function createErrorResult(
  guardrailName: string,
  analysis: LLMErrorOutput,
  additionalInfo: Record<string, unknown> = {},
  tokenUsage?: TokenUsage
): GuardrailResult {
  return {
    tripwireTriggered: false,
    executionFailed: true,
    originalException: new Error(String(analysis.info?.error_message || 'LLM execution failed')),
    info: {
      guardrail_name: guardrailName,
      flagged: analysis.flagged,
      confidence: analysis.confidence,
      ...analysis.info,
      ...additionalInfo,
      ...(tokenUsage ? { token_usage: tokenUsageToDict(tokenUsage) } : {}),
    },
  };
}

/**
 * Assemble a complete LLM prompt with instructions and response schema.
 *
 * Incorporates the supplied system prompt and specifies the required JSON response fields.
 *
 * @param systemPrompt - The instructions describing analysis criteria.
 * @returns Formatted prompt string for LLM input.
 */
function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  if ('unwrap' in schema && typeof schema.unwrap === 'function') {
    return unwrapSchema(schema.unwrap());
  }

  const def = (schema as { _def?: Record<string, unknown> })._def as
    | {
        innerType?: ZodTypeAny;
        schema?: ZodTypeAny;
        type?: ZodTypeAny;
      }
    | undefined;

  if (!def) {
    return schema;
  }

  if (def.innerType) {
    return unwrapSchema(def.innerType);
  }

  if (def.schema) {
    return unwrapSchema(def.schema as ZodTypeAny);
  }

  if (def.type) {
    return unwrapSchema(def.type as ZodTypeAny);
  }

  return schema;
}

function describeSchemaType(schema: ZodTypeAny): string {
  const base = unwrapSchema(schema);

  if (base instanceof z.ZodBoolean) {
    return 'boolean';
  }

  if (base instanceof z.ZodNumber) {
    return 'float';
  }

  if (base instanceof z.ZodString) {
    return 'string';
  }

  if (base instanceof z.ZodArray) {
    return 'array';
  }

  if (base instanceof z.ZodObject) {
    return 'object';
  }

  return 'value';
}

function formatFieldInstruction(fieldName: string, schema: ZodTypeAny): string {
  if (fieldName === 'flagged') {
    return '- "flagged": boolean (true if detected and false otherwise)';
  }

  if (fieldName === 'confidence') {
    return '- "confidence": float (0.0 to 1.0)';
  }

  if (fieldName === 'reason') {
    return '- "reason": string explaining the rationale for the decision';
  }

  const valueType = describeSchemaType(schema);
  return `- "${fieldName}": ${valueType}`;
}

function buildFieldInstructionBlock(outputModel?: ZodTypeAny): string | null {
  if (!outputModel || !(outputModel instanceof z.ZodObject)) {
    return null;
  }

  const shape = outputModel.shape;
  const instructions = Object.entries(shape).map(([key, schema]) =>
    formatFieldInstruction(key, schema as ZodTypeAny)
  );

  return instructions.join('\n');
}

export function buildFullPrompt(systemPrompt: string, outputModel?: ZodTypeAny): string {
  // Check if the system prompt already contains JSON output format instructions
  // Look for phrases that indicate output formatting requirements, not just mentions of JSON
  const hasJsonOutputInstructions = /(?:respond|output|return)\s+(?:with\s+)?(?:a\s+)?json|format.*json/i.test(systemPrompt);
  
  if (hasJsonOutputInstructions) {
    // If the system prompt already has detailed JSON instructions, use it as-is
    return systemPrompt;
  }

  const fieldInstructions = buildFieldInstructionBlock(outputModel);

  // Default template for simple cases - always include "json" for OpenAI's response_format requirement
  const template = `
${systemPrompt}

Respond with a json object containing:
${fieldInstructions ?? '- "flagged": boolean (true if detected and false otherwise)\n- "confidence": float (0.0 to 1.0)'}

Only respond with the json object, nothing else.

**IMPORTANT:**
You must output a confidence score reflecting how likely the input is violative of the guardrail:
- 1.0 = Certain violative
- 0.0 = Certain not violative
- Use the full range [0.0 - 1.0] to reflect your level of certainty

Analyze the following text according to the instructions above.
`;
  return template.trim();
}

/**
 * Remove JSON code fencing (```json ... ```) from a response, if present.
 *
 * This function is defensive: it returns the input string unchanged unless
 * a valid JSON code fence is detected and parseable.
 *
 * @param text - LLM output, possibly wrapped in a JSON code fence.
 * @returns Extracted JSON string or the original string.
 */
function stripJsonCodeFence(text: string): string {
  const lines = text.trim().split('\n');
  if (lines.length < 3) {
    return text;
  }

  const [first, ...body] = lines;
  const last = body.pop();

  if (!first?.startsWith('```json') || last !== '```') {
    return text;
  }

  const candidate = body.join('\n');
  try {
    JSON.parse(candidate);
  } catch {
    return text;
  }

  return candidate;
}

/**
 * Run an LLM analysis for a given prompt and user input.
 *
 * Invokes the OpenAI LLM, enforces prompt/response contract, parses the LLM's
 * output, and returns a validated result.
 *
 * @param text - Text to analyze.
 * @param systemPrompt - Prompt instructions for the LLM.
 * @param client - OpenAI client for LLM inference.
 * @param model - Identifier for which LLM model to use.
 * @param outputModel - Model for parsing and validating the LLM's response.
 * @returns Structured output containing the detection decision and confidence.
 */
export async function runLLM<TOutput extends ZodTypeAny>(
  text: string,
  systemPrompt: string,
  client: OpenAI,
  model: string,
  outputModel: TOutput
): Promise<[z.infer<TOutput> | LLMErrorOutput, TokenUsage]> {
  const fullPrompt = buildFullPrompt(systemPrompt, outputModel);
  const noUsage: TokenUsage = Object.freeze({
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    unavailable_reason: 'LLM call failed before usage could be recorded',
  });

  // Declare tokenUsage outside try block so it's accessible in catch
  // when JSON parsing or schema validation fails after a successful API call
  let tokenUsage: TokenUsage = noUsage;

  try {
    // Handle temperature based on model capabilities
    let temperature = 0.0;
    if (model.includes('gpt-5')) {
      // GPT-5 doesn't support temperature 0, use default (1)
      temperature = 1.0;
    }

    // Build API call parameters
    const params: Record<string, unknown> = {
      messages: [
        { role: 'system', content: fullPrompt },
        { role: 'user', content: `# Text\n\n${text}` },
      ],
      model: model,
      temperature: temperature,
      response_format: { type: 'json_object' },
    };
    
    // Only include safety_identifier for official OpenAI API (not Azure or local providers)
    if (supportsSafetyIdentifier(client)) {
      // @ts-ignore - safety_identifier is not defined in OpenAI types yet
      params.safety_identifier = SAFETY_IDENTIFIER;
    }

    // @ts-ignore - safety_identifier is not in the OpenAI types yet
    const response = await client.chat.completions.create(params);

    // Extract token usage immediately after API call so it's available even if parsing fails
    tokenUsage = extractTokenUsage(response);
    const result = response.choices[0]?.message?.content;
    if (!result) {
      return [
        LLMErrorOutput.parse({
          flagged: false,
          confidence: 0.0,
          info: {
            error_message: 'LLM returned no content',
          },
        }),
        tokenUsage,
      ];
    }

    const cleanedResult = stripJsonCodeFence(result);
    return [outputModel.parse(JSON.parse(cleanedResult)), tokenUsage];
  } catch (error) {
    console.error('LLM guardrail failed for prompt:', systemPrompt, error);

    // Check if this is a content filter error - Azure OpenAI
    if (error && typeof error === 'string' && error.includes('content_filter')) {
      console.warn('Content filter triggered by provider:', error);
      return [
        LLMErrorOutput.parse({
          flagged: true,
          confidence: 1.0,
          info: {
            third_party_filter: true,
            error_message: String(error),
          },
        }),
        noUsage,
      ];
    }

    // Fail-open on JSON parsing errors (malformed or non-JSON responses)
    // Use tokenUsage here since API call succeeded but response parsing failed
    if (error instanceof SyntaxError || (error as Error)?.constructor?.name === 'SyntaxError') {
      console.warn('LLM returned non-JSON or malformed JSON.', error);
      return [
        LLMErrorOutput.parse({
          flagged: false,
          confidence: 0.0,
          info: {
            error_message: 'LLM returned non-JSON or malformed JSON.',
          },
        }),
        tokenUsage,
      ];
    }

    // Fail-open on schema validation errors (e.g., wrong types like confidence as string)
    // Use tokenUsage here since API call succeeded but schema validation failed
    if (error instanceof z.ZodError) {
      console.warn('LLM response validation failed.', error);
      return [
        LLMErrorOutput.parse({
          flagged: false,
          confidence: 0.0,
          info: {
            error_message: 'LLM response validation failed.',
            zod_issues: error.issues ?? [],
          },
        }),
        tokenUsage,
      ];
    }

    // Always return error information for other LLM failures
    return [
      LLMErrorOutput.parse({
        flagged: false,
        confidence: 0.0,
        info: {
          error_message: String(error),
        },
      }),
      noUsage,
    ];
  }
}

function isLLMErrorOutput(value: unknown): value is LLMErrorOutput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (!('info' in value)) {
    return false;
  }

  const info = (value as { info?: unknown }).info;
  if (!info || typeof info !== 'object') {
    return false;
  }

  return 'error_message' in info;
}

export function createLLMCheckFn(
  name: string,
  description: string,
  systemPrompt: string,
  outputModel?: typeof LLMOutput,
  configModel: typeof LLMConfig = LLMConfig
): CheckFn<GuardrailLLMContext, string, z.infer<typeof LLMConfig>> {
  // Store the custom output model if provided
  const customOutputModel = outputModel;

  async function guardrailFunc(
    ctx: GuardrailLLMContext,
    data: string,
    config: z.infer<typeof LLMConfig>
  ): Promise<GuardrailResult> {
    let renderedSystemPrompt = systemPrompt;

    // Handle system_prompt_details if present (for user-defined LLM)
    if (config.system_prompt_details) {
      renderedSystemPrompt = systemPrompt.replace(
        '{system_prompt_details}',
        config.system_prompt_details
      );
    }

    // Determine output model: custom model takes precedence, otherwise use include_reasoning
    let selectedOutputModel: typeof LLMOutput;
    if (customOutputModel !== undefined) {
      // Always use the custom model if provided
      selectedOutputModel = customOutputModel;
    } else {
      // No custom model: use include_reasoning to decide
      const includeReasoning = config.include_reasoning ?? false;
      selectedOutputModel = includeReasoning ? LLMReasoningOutput : LLMOutput;
    }

    const [analysis, tokenUsage] = await runLLM(
      data,
      renderedSystemPrompt,
      ctx.guardrailLlm as OpenAI, // Type assertion to handle OpenAI client compatibility
      config.model,
      selectedOutputModel
    );

    if (isLLMErrorOutput(analysis)) {
      return createErrorResult(name, analysis, {}, tokenUsage);
    }

    const isTrigger = analysis.flagged && analysis.confidence >= config.confidence_threshold;
    return {
      tripwireTriggered: isTrigger,
      info: {
        guardrail_name: name,
        ...analysis,
        threshold: config.confidence_threshold,
        token_usage: tokenUsageToDict(tokenUsage),
      },
    };
  }

  defaultSpecRegistry.register(
    name,
    guardrailFunc,
    description,
    'text/plain',
    configModel as z.ZodType<z.infer<typeof LLMConfig>>,
    LLMContext,
    { engine: 'LLM' }
  );

  return guardrailFunc;
}

/**
 * Context requirements for LLM-based guardrails.
 */
export const LLMContext = z.object({
  guardrailLlm: z.any(),
}) as z.ZodType<GuardrailLLMContext>;
