/**
 * Keywords-based content filtering guardrail.
 *
 * This guardrail checks if specified keywords appear in the input text
 * and can be configured to trigger tripwires based on keyword matches.
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { defaultSpecRegistry } from '../registry';

/**
 * Configuration schema for the keywords guardrail.
 */
export const KeywordsConfig = z.object({
  /** List of keywords to check for */
  keywords: z.array(z.string()).min(1),
});

export type KeywordsConfig = z.infer<typeof KeywordsConfig>;

// Schema for registry registration (without optional properties)
export const KeywordsConfigRequired = KeywordsConfig;

/**
 * Context requirements for the keywords guardrail.
 */
export const KeywordsContext = z.object({});

export type KeywordsContext = z.infer<typeof KeywordsContext>;

/**
 * Keywords-based content filtering guardrail.
 *
 * Checks if any of the configured keywords appear in the input text.
 * Can be configured to trigger tripwires on matches or just report them.
 *
 * @param ctx Runtime context (unused for this guardrail)
 * @param text Input text to check
 * @param config Configuration specifying keywords and behavior
 * @returns GuardrailResult indicating if tripwire was triggered
 */
const WORD_CHAR_CLASS = '[\\p{L}\\p{N}_]';
const isWordChar = (() => {
  const wordCharRegex = new RegExp(WORD_CHAR_CLASS, 'u');
  return (char: string | undefined): boolean => {
    if (!char) return false;
    return wordCharRegex.test(char);
  };
})();

export const keywordsCheck: CheckFn<KeywordsContext, string, KeywordsConfig> = (
  ctx,
  text,
  config
): GuardrailResult => {
  // Handle the case where config might be wrapped in another object
  const actualConfig = (config as Record<string, unknown>).config || config;
  const { keywords } = actualConfig as KeywordsConfig;

  // Sanitize keywords by stripping trailing punctuation
  const sanitizedKeywords = keywords.map((k: string) => k.replace(/[.,!?;:]+$/, ''));

  const keywordEntries = sanitizedKeywords
    .map((sanitized) => ({
      sanitized,
      escaped: sanitized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    }))
    .filter(({ sanitized }) => sanitized.length > 0);

  if (keywordEntries.length === 0) {
    return {
      tripwireTriggered: false,
      info: {
        matchedKeywords: [],
        originalKeywords: keywords,
        sanitizedKeywords,
        totalKeywords: keywords.length,
        textLength: text.length,
      },
    };
  }

  // Apply unicode-aware word boundaries per keyword so tokens that start/end with punctuation still match.
  const keywordPatterns = keywordEntries.map(({ sanitized, escaped }) => {
    const keywordChars = Array.from(sanitized);
    const firstChar = keywordChars[0];
    const lastChar = keywordChars[keywordChars.length - 1];
    const needsLeftBoundary = isWordChar(firstChar);
    const needsRightBoundary = isWordChar(lastChar);
    const leftBoundary = needsLeftBoundary ? `(?<!${WORD_CHAR_CLASS})` : '';
    const rightBoundary = needsRightBoundary ? `(?!${WORD_CHAR_CLASS})` : '';
    return `${leftBoundary}${escaped}${rightBoundary}`;
  });

  const patternText = `(?:${keywordPatterns.join('|')})`;
  const pattern = new RegExp(patternText, 'giu'); // case-insensitive, global, unicode aware

  const matches: string[] = [];
  let match;
  const seen = new Set<string>();

  // Find all matches and collect unique ones (case-insensitive)
  while ((match = pattern.exec(text)) !== null) {
    const matchedText = match[0];
    if (!seen.has(matchedText.toLowerCase())) {
      matches.push(matchedText);
      seen.add(matchedText.toLowerCase());
    }
  }

  const tripwireTriggered = matches.length > 0;

  return {
    tripwireTriggered,
    info: {
      matchedKeywords: matches,
      originalKeywords: keywords,
      sanitizedKeywords: sanitizedKeywords,
      totalKeywords: keywords.length,
      textLength: text.length,
    },
  };
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Keyword Filter',
  keywordsCheck,
  'Checks for specified keywords in text',
  'text/plain',
  KeywordsConfigRequired,
  KeywordsContext,
  { engine: 'regex' }
);
