/**
 * NSFW content detection guardrail module.
 *
 * This module provides a guardrail for detecting Not Safe For Work (NSFW) content in text,
 * including explicit sexual content, adult themes, profanity, and inappropriate material. It uses an
 * LLM to analyze text for various categories of NSFW content.
 *
 * Performance Metrics:
 *     For detailed performance benchmarks and evaluation results, see our
 *     [benchmarking page](/benchmarking/nsfw/).
 *
 * Constants:
 *     SYSTEM_PROMPT: Detailed LLM prompt guiding NSFW detection and classification.
 *
 * Attributes:
 *     nsfw_content: Registered guardrail check_fn for NSFW text content detection.
 *
 * Configuration Parameters:
 *     This guardrail uses the base LLM configuration (see LLMConfig) with these parameters:
 *
 *     - `model` (str): The name of the LLM model to use (e.g., "gpt-4", "gpt-3.5-turbo")
 *     - `confidence_threshold` (float): Minimum confidence score (0.0 to 1.0) required to
 *         trigger the guardrail. Defaults to 0.7.
 *
 * Examples:
 * ```typescript
 *     const config = {
 *         model: "gpt-4.1-mini",
 *         confidence_threshold: 0.8
 *     };
 *     const result = await nsfw_content(null, "Explicit adult content...", config);
 *     console.log(result.tripwireTriggered); // true
 * ```
 */

import { CheckFn, GuardrailLLMContext } from '../types';
import { LLMConfig, createLLMCheckFn } from './llm-base';

/**
 * Context requirements for the NSFW guardrail.
 */
export type NsfwContext = GuardrailLLMContext;

/**
 * Detailed LLM prompt guiding NSFW detection and classification.
 */
const SYSTEM_PROMPT = `
You are a content moderation assistant.
Your task is to analyze text and determine if it contains NSFW (Not Safe For Work) content.

Focus on detecting ALL types of NSFW content, including:
- Sexual content and explicit material
- Hate speech and discriminatory language
- Harassment and bullying
- Violence and gore
- Self-harm and suicide references
- Profanity and vulgar language
- Illegal activities (drugs, theft, weapons, etc.)
- Adult themes and mature content
- Inappropriate workplace content
- Extremist or radical content
- Exploitation or abuse
- Graphic medical content
- Other potentially offensive or inappropriate content

Flag any content that matches these criteria.
`.trim();

/**
 * NSFW content detection guardrail using LLM.
 *
 * Detects NSFW (Not Safe For Work) content in text, including sexual content,
 * hate speech, violence, profanity, illegal activities, and other inappropriate material.
 */
export const nsfw_content: CheckFn<NsfwContext, string, LLMConfig> = createLLMCheckFn(
  'NSFW Text',
  'Detects NSFW (Not Safe For Work) content in text, including sexual content, hate speech, violence, profanity, illegal activities, and other inappropriate material.',
  SYSTEM_PROMPT,
  undefined, // Let createLLMCheckFn handle include_reasoning automatically
  LLMConfig
);
