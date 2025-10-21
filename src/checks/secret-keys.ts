/**
 * Secret key detection guardrail module.
 *
 * This module provides functions and configuration for detecting potential API keys,
 * secrets, and credentials in text. It includes entropy and diversity checks, pattern
 * recognition, and a guardrail check_fn for runtime enforcement.
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { defaultSpecRegistry } from '../registry';

/**
 * Configuration for secret key and credential detection.
 */
export const SecretKeysConfig = z.object({
  /** Detection sensitivity level */
  threshold: z.enum(['strict', 'balanced', 'permissive']).default('balanced'),
  /** Optional list of custom regex patterns to check for secrets */
  custom_regex: z.array(z.string()).optional(),
});

export type SecretKeysConfig = z.infer<typeof SecretKeysConfig>;

/**
 * Context requirements for the secret keys guardrail.
 */
export const SecretKeysContext = z.object({});

export type SecretKeysContext = z.infer<typeof SecretKeysContext>;

/**
 * Common key prefixes used in secret keys.
 */
const COMMON_KEY_PREFIXES = [
  'key-',
  'sk-',
  'sk_',
  'pk_',
  'pk-',
  'ghp_',
  'AKIA',
  'xox',
  'SG.',
  'hf_',
  'api-',
  'apikey-',
  'token-',
  'secret-',
  'SHA:',
  'Bearer ',
];

/**
 * File extensions to ignore when strict_mode is False.
 */
const ALLOWED_EXTENSIONS = [
  '.py',
  '.js',
  '.html',
  '.css',
  '.json',
  '.md',
  '.txt',
  '.csv',
  '.xml',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.config',
  '.log',
  '.sql',
  '.sh',
  '.bat',
  '.dll',
  '.so',
  '.dylib',
  '.jar',
  '.war',
  '.php',
  '.rb',
  '.go',
  '.rs',
  '.ts',
  '.jsx',
  '.vue',
  '.cpp',
  '.c',
  '.h',
  '.cs',
  '.fs',
  '.vb',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
];

/**
 * Configuration presets for different sensitivity levels.
 */
const CONFIGS: Record<
  string,
  {
    min_length: number;
    min_entropy: number;
    min_diversity: number;
    strict_mode: boolean;
  }
> = {
  strict: {
    min_length: 10,
    min_entropy: 3.0, // Lowered from 3.5 to be more reasonable
    min_diversity: 2,
    strict_mode: true,
  },
  balanced: {
    min_length: 10, // Lowered to catch more common keys
    min_entropy: 3.8,
    min_diversity: 3,
    strict_mode: false,
  },
  permissive: {
    min_length: 20,
    min_entropy: 3.5,
    min_diversity: 2, // Lowered from 3 to be more reasonable
    strict_mode: false,
  },
};

/**
 * Calculate the Shannon entropy of a string.
 */
function entropy(s: string): number {
  if (s.length === 0) return 0;

  const counts: Record<string, number> = {};
  for (const c of s) {
    counts[c] = (counts[c] || 0) + 1;
  }

  let entropy = 0;
  for (const count of Object.values(counts)) {
    const probability = count / s.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

/**
 * Count the number of character types present in a string.
 */
function charDiversity(s: string): number {
  return [
    s.split('').some((c) => c === c.toLowerCase() && c !== c.toUpperCase()), // lowercase
    s.split('').some((c) => c === c.toUpperCase() && c !== c.toLowerCase()), // uppercase
    s.split('').some((c) => /\d/.test(c)), // digits
    s.split('').some((c) => !/\w/.test(c)), // special characters
  ].filter(Boolean).length;
}

/**
 * Check if text contains allowed URL or file extension patterns.
 */
function containsAllowedPattern(text: string): boolean {
  // Check if it's a URL pattern
  const urlPattern = /^https?:\/\/[a-zA-Z0-9.-]+\/?[a-zA-Z0-9./_-]*$/i;
  if (urlPattern.test(text)) {
    // If it's a URL, check if it contains any secret patterns
    // If it contains secrets, don't allow it
    if (COMMON_KEY_PREFIXES.some((prefix) => text.includes(prefix))) {
      return false;
    }
    return true;
  }

  // Regex for allowed file extensions - must end with the extension
  const extPattern = new RegExp(
    `^[^\\s]*(${ALLOWED_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')})$`,
    'i'
  );
  return extPattern.test(text);
}

/**
 * Check if a string is a secret key using the specified criteria.
 */
function isSecretCandidate(
  s: string,
  cfg: (typeof CONFIGS)[keyof typeof CONFIGS],
  customRegex?: string[]
): boolean {
  // Check custom patterns first if provided
  if (customRegex) {
    for (const pattern of customRegex) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(s)) {
          return true;
        }
      } catch {
        // Invalid regex pattern, skip
        continue;
      }
    }
  }

  if (!cfg.strict_mode && containsAllowedPattern(s)) {
    return false;
  }

  const longEnough = s.length >= cfg.min_length;
  const diverse = charDiversity(s) >= cfg.min_diversity;

  // Check common prefixes first - these should always be detected
  if (COMMON_KEY_PREFIXES.some((prefix) => s.startsWith(prefix))) {
    return true;
  }

  // For other candidates, check length and diversity
  if (!(longEnough && diverse)) {
    return false;
  }

  return entropy(s) >= cfg.min_entropy;
}

/**
 * Detect potential secret keys in text.
 */
function detectSecretKeys(
  text: string,
  cfg: (typeof CONFIGS)[keyof typeof CONFIGS],
  customRegex?: string[]
): GuardrailResult {
  const words = text.split(/\s+/).map((w) => w.replace(/[*#]/g, ''));
  const secrets = words.filter((w) => isSecretCandidate(w, cfg, customRegex));

  // Mask detected secrets in the text
  let checkedText = text;
  for (const secret of secrets) {
    checkedText = checkedText.replace(
      new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      '<SECRET>'
    );
  }

  return {
    tripwireTriggered: secrets.length > 0,
    info: {
      checked_text: checkedText,
      guardrail_name: 'Secret Keys',
      detected_secrets: secrets,
    },
  };
}

/**
 * Async guardrail function for secret key and credential detection.
 *
 * Scans the input for likely secrets or credentials (e.g., API keys, tokens)
 * using entropy, diversity, and pattern rules.
 *
 * @param ctx Guardrail context (unused).
 * @param data Input text to scan.
 * @param config Configuration for secret detection.
 * @returns GuardrailResult indicating if secrets were detected, with findings in info.
 */
export const secretKeysCheck: CheckFn<SecretKeysContext, string, SecretKeysConfig> = async (
  ctx,
  data,
  config
): Promise<GuardrailResult> => {
  const cfg = CONFIGS[config.threshold];
  return detectSecretKeys(data, cfg, config.custom_regex);
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Secret Keys',
  secretKeysCheck,
  'Checks that the text does not contain potential API keys, secrets, or other credentials',
  'text/plain',
  SecretKeysConfig as z.ZodType<SecretKeysConfig>,
  SecretKeysContext as z.ZodType<SecretKeysContext>,
  { engine: 'regex' }
);
