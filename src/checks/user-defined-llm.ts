/**
 * User-defined LLM guardrail for custom content moderation.
 *
 * This module provides a guardrail for implementing custom content checks using
 * Large Language Models (LLMs). It allows users to define their own system prompts
 * for content moderation, enabling flexible and domain-specific guardrail enforcement.
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { defaultSpecRegistry } from '../registry';

/**
 * Configuration schema for user-defined LLM moderation checks.
 *
 * Extends the base LLMConfig with a required field for custom prompt details.
 */
export const UserDefinedConfig = z.object({
  /** The LLM model to use for content checking */
  model: z.string(),
  /** Minimum confidence score (0.0 to 1.0) required to trigger the guardrail. Defaults to 0.7. */
  confidence_threshold: z.number().min(0.0).max(1.0).default(0.7),
  /** Free-form instructions describing content moderation requirements */
  system_prompt_details: z.string(),
});

export type UserDefinedConfig = z.infer<typeof UserDefinedConfig>;

/**
 * Context requirements for the user-defined LLM guardrail.
 */
export const UserDefinedContext = z.object({
  /** OpenAI client for LLM operations */
  guardrailLlm: z.any(),
});

export type UserDefinedContext = z.infer<typeof UserDefinedContext>;

/**
 * Output schema for user-defined LLM analysis.
 */
export const UserDefinedOutput = z.object({
  /** Whether the content was flagged according to the custom criteria */
  flagged: z.boolean(),
  /** Confidence score (0.0 to 1.0) that the input violates the custom criteria */
  confidence: z.number().min(0.0).max(1.0),
  /** Optional reason for the flagging decision */
  reason: z.string().optional(),
});

export type UserDefinedOutput = z.infer<typeof UserDefinedOutput>;

/**
 * System prompt template for user-defined content moderation.
 */
const SYSTEM_PROMPT = `# Instructions

{system_prompt_details}

Flag any content that matches the criteria defined above.

Respond with a JSON object containing:
- "flagged": boolean indicating if content violates the criteria
- "confidence": number between 0.0 and 1.0 indicating confidence in the assessment`;

/**
 * User-defined LLM guardrail.
 *
 * Runs a user-defined guardrail based on a custom system prompt.
 * Allows for flexible content moderation based on specific requirements.
 *
 * @param ctx Guardrail context containing the LLM client.
 * @param data Text to analyze according to custom criteria.
 * @param config Configuration with custom system prompt details.
 * @returns GuardrailResult containing analysis with flagged status
 *         and confidence score.
 */
export const userDefinedLLMCheck: CheckFn<UserDefinedContext, string, UserDefinedConfig> = async (
  ctx,
  data,
  config
): Promise<GuardrailResult> => {
  try {
    // Render the system prompt with custom details
    const renderedSystemPrompt = SYSTEM_PROMPT.replace(
      '{system_prompt_details}',
      config.system_prompt_details
    );

    // Use the OpenAI API to analyze the text
    // Try with JSON response format first, fall back to text if not supported
    let response;
    try {
      response = await ctx.guardrailLlm.chat.completions.create({
        messages: [
          { role: 'system', content: renderedSystemPrompt },
          { role: 'user', content: data },
        ],
        model: config.model,
        temperature: 0.0,
        response_format: { type: 'json_object' },
      });
    } catch (error: unknown) {
      // If JSON response format is not supported, try without it
      if (error && typeof error === 'object' && 'error' in error && 
          (error as { error?: { param?: string } }).error?.param === 'response_format') {
        response = await ctx.guardrailLlm.chat.completions.create({
          messages: [
            { role: 'system', content: renderedSystemPrompt },
            { role: 'user', content: data },
          ],
          model: config.model,
          temperature: 0.0,
        });
      } else {
        // Return error information instead of re-throwing
        return {
          tripwireTriggered: false,
          executionFailed: true,
          originalException: error instanceof Error ? error : new Error(String(error)),
          info: {
            checked_text: data,
            error_message: String(error),
            flagged: false,
            confidence: 0.0,
          },
        };
      }
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        tripwireTriggered: false,
        executionFailed: true,
        originalException: new Error('No response content from LLM'),
        info: {
          checked_text: data,
          error_message: 'No response content from LLM',
          flagged: false,
          confidence: 0.0,
        },
      };
    }

    // Parse the response - try JSON first, fall back to text parsing
    let analysis: UserDefinedOutput;
    try {
      analysis = JSON.parse(content);
    } catch {
      // If JSON parsing fails, try to extract information from text response
      // Look for patterns like "flagged: true/false" and "confidence: 0.8"
      const flaggedMatch = content.match(/flagged:\s*(true|false)/i);
      const confidenceMatch = content.match(/confidence:\s*([0-9.]+)/i);
      const reasonMatch = content.match(/reason:\s*"([^"]+)"/i);

      analysis = {
        flagged: flaggedMatch ? flaggedMatch[1].toLowerCase() === 'true' : false,
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.0,
        reason: reasonMatch ? reasonMatch[1] : 'Could not parse response format',
      };
    }

    // Determine if tripwire should be triggered
    const isTrigger = analysis.flagged && analysis.confidence >= config.confidence_threshold;

    return {
      tripwireTriggered: isTrigger,
      info: {
        checked_text: data, // Custom check doesn't modify the text
        guardrail_name: 'Custom Prompt Check',
        ...analysis,
        threshold: config.confidence_threshold,
        custom_prompt: config.system_prompt_details,
      },
    };
  } catch (error) {
    // Log unexpected errors and return safe default
    console.error('Unexpected error in user-defined LLM check:', error);
    return {
      tripwireTriggered: false,
      executionFailed: true,
      originalException: error instanceof Error ? error : new Error(String(error)),
      info: {
        checked_text: data, // Return original text on error
        guardrail_name: 'Custom Prompt Check',
        flagged: false,
        confidence: 0.0,
        threshold: config.confidence_threshold,
        custom_prompt: config.system_prompt_details,
        error: String(error),
      },
    };
  }
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Custom Prompt Check',
  userDefinedLLMCheck,
  'User-defined LLM guardrail for custom content moderation',
  'text/plain',
  UserDefinedConfig as z.ZodType<UserDefinedConfig>,
  UserDefinedContext,
  { engine: 'llm' }
);
