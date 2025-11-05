/**
 * Topical alignment guardrail module.
 *
 * This module provides a guardrail for ensuring content stays within a specified
 * business scope or topic domain. It uses an LLM to analyze text against a defined
 * context to detect off-topic or irrelevant content.
 */

import { z } from 'zod';
import { CheckFn, GuardrailLLMContext } from '../types';
import { LLMConfig, LLMOutput, createLLMCheckFn } from './llm-base';

/**
 * Configuration for topical alignment guardrail.
 *
 * Extends LLMConfig with a required business scope for content checks.
 */
export const TopicalAlignmentConfig = LLMConfig.omit({ system_prompt_details: true }).extend({
  /** Description of the allowed business scope or on-topic context */
  system_prompt_details: z.string().describe('Description of the allowed business scope or on-topic context'),
});

export type TopicalAlignmentConfig = z.infer<typeof TopicalAlignmentConfig>;

/**
 * Context requirements for the topical alignment guardrail.
 */
export type TopicalAlignmentContext = GuardrailLLMContext;

/**
 * Output schema for topical alignment analysis.
 */
export const TopicalAlignmentOutput = LLMOutput;

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
 * Checks that the content stays within the defined business scope using
 * an LLM to analyze text against a defined context.
 */
export const topicalAlignment: CheckFn<TopicalAlignmentContext, string, TopicalAlignmentConfig> =
  createLLMCheckFn(
    'Off Topic Prompts',
    'Checks that the content stays within the defined business scope',
    SYSTEM_PROMPT,
    TopicalAlignmentOutput,
    TopicalAlignmentConfig as unknown as typeof LLMConfig
  ) as CheckFn<TopicalAlignmentContext, string, TopicalAlignmentConfig>;
