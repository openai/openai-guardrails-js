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
import { SAFETY_IDENTIFIER, supportsSafetyIdentifier } from '../utils/safety-identifier';

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
 * Check if an error is a 404 Not Found error from the OpenAI API.
 *
 * @param error The error to check
 * @returns True if the error is a 404 error
 */
function isNotFoundError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'status' in error && error.status === 404);
}

/**
 * Call the OpenAI moderation API.
 *
 * @param client The OpenAI client to use
 * @param data The text to analyze
 * @returns The moderation API response
 */
function callModerationAPI(
  client: OpenAI,
  data: string
): ReturnType<OpenAI['moderations']['create']> {
  const params: Record<string, unknown> = {
    model: 'omni-moderation-latest',
    input: data,
  };
  
  // Only include safety_identifier for official OpenAI API (not Azure or local providers)
  if (supportsSafetyIdentifier(client)) {
    // @ts-ignore - safety_identifier is not defined in OpenAI types yet
    params.safety_identifier = SAFETY_IDENTIFIER;
  }
  
  // @ts-ignore - safety_identifier is not in the OpenAI types yet
  return client.moderations.create(params);
}

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

  // Get client from context if available
  let client: OpenAI | null = null;
  if (ctx) {
    const contextObj = ctx as Record<string, unknown>;
    const candidate = contextObj.guardrailLlm;
    if (candidate && candidate instanceof OpenAI) {
      client = candidate;
    }
  }

  try {
    // Try the context client first, fall back if moderation endpoint doesn't exist
    let resp: Awaited<ReturnType<typeof callModerationAPI>>;
    if (client !== null) {
      try {
        resp = await callModerationAPI(client, data);
      } catch (error) {
        // Moderation endpoint doesn't exist on this provider (e.g., third-party)
        // Fall back to the OpenAI client
        if (isNotFoundError(error)) {
          try {
            resp = await callModerationAPI(new OpenAI(), data);
          } catch (fallbackError) {
            // If fallback fails, provide a helpful error message
            const errorMessage = fallbackError instanceof Error 
              ? fallbackError.message 
              : String(fallbackError);
            
            // Check if it's an API key error
            if (errorMessage.includes('api_key') || errorMessage.includes('OPENAI_API_KEY')) {
              return {
                tripwireTriggered: false,
                info: {
                  checked_text: data,
                  error: 'Moderation API requires OpenAI API key. Set OPENAI_API_KEY environment variable or pass a client with valid credentials.',
                },
              };
            }
            throw fallbackError;
          }
        } else {
          throw error;
        }
      }
    } else {
      // No context client, use fallback
      resp = await callModerationAPI(new OpenAI(), data);
    }

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
