/**
 * Moderation guardrail for text content using OpenAI's moderation API.
 *
 * This module provides a guardrail for detecting harmful or policy-violating content
 * using OpenAI's moderation API. It supports filtering by specific content categories
 * and provides detailed analysis of detected violations.
 *
 * Configuration Parameters:
 * `categories` (Category[]): List of moderation categories to check.
 *
 * Available categories listed below. If not specified, all categories are checked by default.
 *
 * Example:
 * ```typescript
 * const cfg = { categories: ["hate", "harassment", "self-harm"] };
 * const result = await moderationCheck(null, "harmful content here", cfg);
 * console.log(result.tripwireTriggered); // true
 * ```
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { defaultSpecRegistry } from '../registry';
import OpenAI from 'openai';

/**
 * Enumeration of supported moderation categories.
 *
 * These categories correspond to types of harmful or restricted content
 * recognized by the OpenAI moderation endpoint.
 */
export enum Category {
  SEXUAL = 'sexual',
  SEXUAL_MINORS = 'sexual/minors',
  HATE = 'hate',
  HATE_THREATENING = 'hate/threatening',
  HARASSMENT = 'harassment',
  HARASSMENT_THREATENING = 'harassment/threatening',
  SELF_HARM = 'self-harm',
  SELF_HARM_INTENT = 'self-harm/intent',
  SELF_HARM_INSTRUCTIONS = 'self-harm/instructions',
  VIOLENCE = 'violence',
  VIOLENCE_GRAPHIC = 'violence/graphic',
  ILLICIT = 'illicit',
  ILLICIT_VIOLENT = 'illicit/violent',
}

/**
 * Configuration schema for the moderation guardrail.
 *
 * This configuration allows selection of specific moderation categories to check.
 * If no categories are specified, all supported categories will be checked.
 */
export const ModerationConfig = z.object({
  /** List of moderation categories to check. Defaults to all categories if not specified. */
  categories: z.array(z.nativeEnum(Category)).default(Object.values(Category)),
});

export type ModerationConfig = z.infer<typeof ModerationConfig>;

// Schema for registry registration (with defaults)
export const ModerationConfigRequired = z
  .object({
    categories: z.array(z.nativeEnum(Category)),
  })
  .transform((data) => ({
    ...data,
    categories: data.categories ?? Object.values(Category),
  }));

/**
 * Context requirements for the moderation guardrail.
 */
export const ModerationContext = z.object({
  /** Optional OpenAI client to reuse instead of creating a new one */
  guardrailLlm: z.unknown().optional(),
});

export type ModerationContext = z.infer<typeof ModerationContext>;

/**
 * Guardrail check_fn to flag disallowed content categories using OpenAI moderation API.
 *
 * Calls the OpenAI moderation endpoint on input text and flags if any of the
 * configured categories are detected. Returns a result containing flagged
 * categories, details, and tripwire status.
 *
 * @param ctx Runtime context (unused)
 * @param data User or model text to analyze
 * @param config Moderation config specifying categories to flag
 * @returns GuardrailResult indicating if tripwire was triggered, and details of flagged categories
 */
export const moderationCheck: CheckFn<ModerationContext, string, ModerationConfig> = async (
  ctx,
  data,
  config
): Promise<GuardrailResult> => {
  // Handle the case where config might be wrapped in another object
  const actualConfig = (config as Record<string, unknown>).config || config;

  // Ensure categories is an array
  const configObj = actualConfig as Record<string, unknown>;
  const categories = (configObj.categories as string[]) || Object.values(Category);

  // Reuse provided client only if it targets the official OpenAI API.
  const reuseClientIfOpenAI = (context: unknown): OpenAI | null => {
    try {
      const contextObj = context as Record<string, unknown>;
      const candidate = contextObj?.guardrailLlm;
      if (!candidate || typeof candidate !== 'object') return null;
      if (!(candidate instanceof OpenAI)) return null;

      const candidateObj = candidate as unknown as Record<string, unknown>;
      const baseURL: string | undefined =
        (candidateObj.baseURL as string) ??
        ((candidateObj._client as Record<string, unknown>)?.baseURL as string) ??
        (candidateObj._baseURL as string);

      if (
        baseURL === undefined ||
        (typeof baseURL === 'string' && baseURL.includes('api.openai.com'))
      ) {
        return candidate as OpenAI;
      }
      return null;
    } catch {
      return null;
    }
  };

  const client = reuseClientIfOpenAI(ctx) ?? new OpenAI();

  try {
    const resp = await client.moderations.create({
      model: 'omni-moderation-latest',
      input: data,
    });

    const results = resp.results || [];
    if (!results.length) {
      return {
        tripwireTriggered: false,
        info: {
          checked_text: data,
          error: 'No moderation results returned',
        },
      };
    }

    const outcome = results[0];
    const moderationCategories = outcome.categories || {};

    // Check only the categories specified in config and collect results
    const flaggedCategories: string[] = [];
    const categoryDetails: Record<string, boolean> = {};

    for (const cat of categories) {
      const catValue = cat;
      const isFlagged = (moderationCategories as unknown as Record<string, boolean>)[catValue] || false;
      if (isFlagged) {
        flaggedCategories.push(catValue);
      }
      categoryDetails[catValue] = isFlagged;
    }

    // Only trigger if the requested categories are flagged
    const isFlagged = flaggedCategories.length > 0;

    return {
      tripwireTriggered: isFlagged,
      info: {
        checked_text: data, // Moderation doesn't modify the text
        guardrail_name: 'Moderation',
        flagged_categories: flaggedCategories,
        categories_checked: categories,
        category_details: categoryDetails,
      },
    };
  } catch (error) {
    console.warn('AI-based moderation failed:', error);
    return {
      tripwireTriggered: false,
      info: {
        checked_text: data,
        error: 'Moderation API call failed',
      },
    };
  }
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Moderation',
  moderationCheck,
  'Flags text containing disallowed content categories',
  'text/plain',
  ModerationConfigRequired,
  ModerationContext,
  { engine: 'API' }
);
