/**
 * LLM-based guardrail content checking.
 *
 * This module enables the creation and registration of content moderation guardrails
 * using Large Language Models (LLMs). It provides configuration and output schemas,
 * prompt helpers, a utility for executing LLM-based checks, and a factory for generating
 * guardrail check functions leveraging LLMs.
 */

import { z } from 'zod';
import { OpenAI } from 'openai';
import { CheckFn, GuardrailResult, GuardrailLLMContext } from '../types';
import { defaultSpecRegistry } from '../registry';

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
 * Assemble a complete LLM prompt with instructions and response schema.
 *
 * Incorporates the supplied system prompt and specifies the required JSON response fields.
 *
 * @param systemPrompt - The instructions describing analysis criteria.
 * @returns Formatted prompt string for LLM input.
 */
export function buildFullPrompt(systemPrompt: string): string {
  // Check if the system prompt already contains JSON schema instructions
  if (
    systemPrompt.includes('JSON') ||
    systemPrompt.includes('json') ||
    systemPrompt.includes('{')
  ) {
    // If the system prompt already has detailed JSON instructions, use it as-is
    return systemPrompt;
  }

  // Default template for simple cases - always include "json" for OpenAI's response_format requirement
  const template = `
${systemPrompt}

Respond with a json object containing:
- "flagged": boolean (true if detected and false otherwise)
- "confidence": float (0.0 to 1.0)

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
export async function runLLM(
  text: string,
  systemPrompt: string,
  client: OpenAI,
  model: string,
  outputModel: typeof LLMOutput
): Promise<LLMOutput> {
  const fullPrompt = buildFullPrompt(systemPrompt);

  try {
    // Handle temperature based on model capabilities
    let temperature = 0.0;
    if (model.includes('gpt-5')) {
      // GPT-5 doesn't support temperature 0, use default (1)
      temperature = 1.0;
    }

    const response = await client.chat.completions.create({
      messages: [
        { role: 'system', content: fullPrompt },
        { role: 'user', content: `# Text\n\n${text}` },
      ],
      model: model,
      temperature: temperature,
      response_format: { type: 'json_object' },
    });

    const result = response.choices[0]?.message?.content;
    if (!result) {
      return {
        flagged: false,
        confidence: 0.0,
      };
    }

    const cleanedResult = stripJsonCodeFence(result);
    return outputModel.parse(JSON.parse(cleanedResult));
  } catch (error) {
    console.error('LLM guardrail failed for prompt:', systemPrompt, error);

    // Check if this is a content filter error - Azure OpenAI
    if (error && typeof error === 'string' && error.includes('content_filter')) {
      console.warn('Content filter triggered by provider:', error);
      return {
        flagged: true,
        confidence: 1.0,
        info: {
          third_party_filter: true,
          error_message: String(error),
        },
      } as LLMErrorOutput;
    }

    // Fail-closed on JSON parsing errors (malformed or non-JSON responses)
    if (error instanceof SyntaxError || (error as Error)?.constructor?.name === 'SyntaxError') {
      console.warn(
        'LLM returned non-JSON or malformed JSON. Failing closed (flagged=true).',
        error
      );
      return {
        flagged: true,
        confidence: 1.0,
      } as LLMOutput;
    }

    // Fail-closed on schema validation errors (e.g., wrong types like confidence as string)
    if (error instanceof z.ZodError) {
      console.warn('LLM response validation failed. Failing closed (flagged=true).', error);
      return {
        flagged: true,
        confidence: 1.0,
      } as LLMOutput;
    }

    // Always return error information for other LLM failures
    return {
      flagged: false,
      confidence: 0.0,
      info: {
        error_message: String(error),
      },
    } as LLMErrorOutput;
  }
}

/**
 * Factory for constructing and registering an LLM-based guardrail check_fn.
 *
 * This helper registers the guardrail with the default registry and returns a
 * check_fn suitable for use in guardrail pipelines. The returned function will
 * use the configured LLM to analyze text, validate the result, and trigger if
 * confidence exceeds the provided threshold.
 *
 * @param name - Name under which to register the guardrail.
 * @param description - Short explanation of the guardrail's logic.
 * @param systemPrompt - Prompt passed to the LLM to control analysis.
 * @param outputModel - Schema for parsing the LLM output.
 * @param configModel - Configuration schema for the check_fn.
 * @returns Async check function to be registered as a guardrail.
 */
export function createLLMCheckFn(
  name: string,
  description: string,
  systemPrompt: string,
  outputModel: typeof LLMOutput = LLMOutput,
  configModel: typeof LLMConfig = LLMConfig
): CheckFn<GuardrailLLMContext, string, z.infer<typeof LLMConfig>> {
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

    const analysis = await runLLM(
      data,
      renderedSystemPrompt,
      ctx.guardrailLlm as OpenAI, // Type assertion to handle OpenAI client compatibility
      config.model,
      outputModel
    );

    // Check if this is an error result (LLMErrorOutput with error_message)
    if ('info' in analysis && analysis.info) {
      const errorInfo = analysis.info as Record<string, unknown>;
      if (errorInfo.error_message) {
        // This is an execution failure (LLMErrorOutput)
        return {
          tripwireTriggered: false, // Don't trigger tripwire on execution errors
          executionFailed: true,
          originalException: new Error(String(errorInfo.error_message || 'LLM execution failed')),
          info: {
            checked_text: data,
            guardrail_name: name,
            ...analysis,
          },
        };
      }
    }

    // Compare severity levels
    const isTrigger = analysis.flagged && analysis.confidence >= config.confidence_threshold;
    return {
      tripwireTriggered: isTrigger,
      info: {
        checked_text: data, // LLM guardrails typically don't modify the text
        guardrail_name: name,
        ...analysis,
        threshold: config.confidence_threshold,
      },
    };
  }

  // Auto-register this guardrail with the default registry
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
