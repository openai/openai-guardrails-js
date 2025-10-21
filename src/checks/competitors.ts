/**
 * Competitor detection guardrail module.
 *
 * This module provides a guardrail for detecting mentions of competitors in text.
 * It uses case-insensitive keyword matching against a configurable list of competitor names.
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { KeywordsConfig, keywordsCheck } from './keywords';
import { defaultSpecRegistry } from '../registry';

/**
 * Configuration schema for competitor detection.
 *
 * This configuration is used to specify a list of competitor names that will be
 * flagged if detected in the analyzed text. Matching is case-insensitive.
 */
export const CompetitorConfig = z.object({
  /** List of competitor names to detect. Matching is case-insensitive. */
  keywords: z.array(z.string()).min(1),
});

export type CompetitorConfig = z.infer<typeof CompetitorConfig>;

/**
 * Context requirements for the competitors guardrail.
 */
export const CompetitorContext = z.object({});

export type CompetitorContext = z.infer<typeof CompetitorContext>;

/**
 * Guardrail function to flag competitor mentions in text.
 *
 * Checks the provided text for the presence of any competitor names specified
 * in the configuration. Returns a `GuardrailResult` indicating whether any
 * competitor keyword was found.
 *
 * @param ctx Context object for the guardrail runtime (unused).
 * @param data Text to analyze for competitor mentions.
 * @param config Configuration specifying competitor keywords.
 * @returns GuardrailResult indicating whether any competitor keyword was detected.
 */
export const competitorsCheck: CheckFn<CompetitorContext, string, CompetitorConfig> = (
  ctx,
  data,
  config
): GuardrailResult => {
  // Convert to KeywordsConfig format and reuse the keywords check
  const keywordsConfig: KeywordsConfig = {
    keywords: config.keywords,
  };

  const result = keywordsCheck(ctx, data, keywordsConfig) as GuardrailResult;

  // Update the guardrail name in the result
  return {
    ...result,
    info: {
      ...result.info,
      guardrail_name: 'Competitors',
    },
  };
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Competitors',
  competitorsCheck,
  'Checks if the model output mentions any competitors from the provided list',
  'text/plain',
  CompetitorConfig,
  CompetitorContext,
  { engine: 'regex' }
);
