/**
 * Topical alignment guardrail module.
 *
 * This module provides a guardrail for ensuring content stays within a specified
 * business scope or topic domain. It uses an LLM to analyze text against a defined
 * context to detect off-topic or irrelevant content.
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { defaultSpecRegistry } from '../registry';
import { buildFullPrompt } from './llm-base';

/**
 * Configuration for topical alignment guardrail.
 *
 * Extends LLMConfig with a required business scope for content checks.
 */
export const TopicalAlignmentConfig = z.object({
  /** The LLM model to use for content checking */
  model: z.string(),
  /** Minimum confidence score (0.0 to 1.0) required to trigger the guardrail. Defaults to 0.7. */
  confidence_threshold: z.number().min(0.0).max(1.0).default(0.7),
  /** Description of the allowed business scope or on-topic context */
  system_prompt_details: z.string(),
});

export type TopicalAlignmentConfig = z.infer<typeof TopicalAlignmentConfig>;

/**
 * Context requirements for the topical alignment guardrail.
 */
export const TopicalAlignmentContext = z.object({
  /** OpenAI client for LLM operations */
  guardrailLlm: z.any(),
});

export type TopicalAlignmentContext = z.infer<typeof TopicalAlignmentContext>;

/**
 * Output schema for topical alignment analysis.
 */
export const TopicalAlignmentOutput = z.object({
  /** Whether the content was flagged as off-topic */
  flagged: z.boolean(),
  /** Confidence score (0.0 to 1.0) that the input is off-topic */
  confidence: z.number().min(0.0).max(1.0),
});

export type TopicalAlignmentOutput = z.infer<typeof TopicalAlignmentOutput>;

/**
 * System prompt for topical alignment analysis.
 */
const SYSTEM_PROMPT = `You are a content analysis system that determines if text stays on topic.

BUSINESS SCOPE: {system_prompt_details}

Determine if the text stays within the defined business scope. Flag any content
that strays from the allowed topics.`;

/**
 * Topical alignment guardrail.
 *
 * Checks that the content stays within the defined business scope.
 *
 * @param ctx Guardrail context containing the LLM client.
 * @param data Text to analyze for topical alignment.
 * @param config Configuration for topical alignment detection.
 * @returns GuardrailResult containing topical alignment analysis with flagged status
 *         and confidence score.
 */
export const topicalAlignmentCheck: CheckFn<
  TopicalAlignmentContext,
  string,
  TopicalAlignmentConfig
> = async (ctx, data, config): Promise<GuardrailResult> => {
  try {
    // Render the system prompt with business scope details
    const renderedSystemPrompt = SYSTEM_PROMPT.replace(
      '{system_prompt_details}',
      config.system_prompt_details
    );

    // Use buildFullPrompt to ensure "json" is included for OpenAI's response_format requirement
    const fullPrompt = buildFullPrompt(renderedSystemPrompt);

    // Use the OpenAI API to analyze the text
    const response = await ctx.guardrailLlm.chat.completions.create({
      messages: [
        { role: 'system', content: fullPrompt },
        { role: 'user', content: data },
      ],
      model: config.model,
      temperature: 0.0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from LLM');
    }

    // Parse the JSON response
    const analysis: TopicalAlignmentOutput = JSON.parse(content);

    // Determine if tripwire should be triggered
    const isTrigger = analysis.flagged && analysis.confidence >= config.confidence_threshold;

    return {
      tripwireTriggered: isTrigger,
      info: {
        checked_text: data, // Alignment doesn't modify the text
        guardrail_name: 'Off Topic Content',
        ...analysis,
        threshold: config.confidence_threshold,
        business_scope: config.system_prompt_details,
      },
    };
  } catch (error) {
    // Log unexpected errors and return safe default
    console.error('Unexpected error in topical alignment detection:', error);
    return {
      tripwireTriggered: false,
      info: {
        checked_text: data, // Return original text on error
        guardrail_name: 'Off Topic Content',
        flagged: false,
        confidence: 0.0,
        threshold: config.confidence_threshold,
        business_scope: config.system_prompt_details,
        error: String(error),
      },
    };
  }
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Off Topic Prompts',
  topicalAlignmentCheck,
  'Checks that the content stays within the defined business scope',
  'text/plain',
  TopicalAlignmentConfig as z.ZodType<TopicalAlignmentConfig>,
  TopicalAlignmentContext,
  { engine: 'llm' }
);
