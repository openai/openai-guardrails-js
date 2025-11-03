/**
 * User-defined LLM guardrail for custom content moderation.
 *
 * This module provides a guardrail for implementing custom content checks using
 * Large Language Models (LLMs). It allows users to define their own system prompts
 * for content moderation, enabling flexible and domain-specific guardrail enforcement.
 */

import { z } from 'zod';
import { CheckFn, GuardrailLLMContext } from '../types';
import { LLMConfig, LLMOutput, createLLMCheckFn } from './llm-base';

/**
 * Configuration schema for user-defined LLM moderation checks.
 *
 * Extends the base LLMConfig with a required field for custom prompt details.
 */
export const UserDefinedConfig = LLMConfig.omit({ system_prompt_details: true }).extend({
  /** Free-form instructions describing content moderation requirements */
  system_prompt_details: z.string().describe('Free-form instructions describing content moderation requirements'),
});

export type UserDefinedConfig = z.infer<typeof UserDefinedConfig>;

/**
 * Context requirements for the user-defined LLM guardrail.
 */
export type UserDefinedContext = GuardrailLLMContext;

/**
 * Output schema for user-defined LLM analysis.
 */
export const UserDefinedOutput = LLMOutput.extend({
  /** Optional reason for the flagging decision */
  reason: z.string().optional(),
});

export type UserDefinedOutput = z.infer<typeof UserDefinedOutput>;

/**
 * System prompt template for user-defined content moderation.
 */
const SYSTEM_PROMPT = `# Instructions

{system_prompt_details}

Flag any content that matches the criteria defined above.`;

/**
 * User-defined LLM guardrail.
 *
 * Runs a user-defined guardrail based on a custom system prompt.
 * Allows for flexible content moderation based on specific requirements.
 */
export const userDefinedLLM: CheckFn<UserDefinedContext, string, UserDefinedConfig> =
  createLLMCheckFn(
    'Custom Prompt Check',
    'User-defined LLM guardrail for custom content moderation',
    SYSTEM_PROMPT,
    UserDefinedOutput,
    UserDefinedConfig as unknown as typeof LLMConfig
  ) as CheckFn<UserDefinedContext, string, UserDefinedConfig>;
