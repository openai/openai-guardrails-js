/**
 * OpenAI safety identifier utilities.
 *
 * This module provides utilities for handling the OpenAI safety_identifier parameter,
 * which is used to track guardrails library usage for monitoring and abuse detection.
 *
 * The safety identifier is only supported by the official OpenAI API and should not
 * be sent to Azure OpenAI or other OpenAI-compatible providers.
 */

import OpenAI from 'openai';

/**
 * OpenAI safety identifier for tracking guardrails library usage.
 */
export const SAFETY_IDENTIFIER = 'openai-guardrails-js';

/**
 * Check if the client supports the safety_identifier parameter.
 *
 * Only the official OpenAI API supports this parameter.
 * Azure OpenAI and local/alternative providers (Ollama, vLLM, etc.) do not.
 *
 * @param client The OpenAI client instance to check
 * @returns True if safety_identifier should be included in API calls, False otherwise
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { supportsSafetyIdentifier } from './safety-identifier';
 *
 * const client = new OpenAI();
 * console.log(supportsSafetyIdentifier(client)); // true
 *
 * const localClient = new OpenAI({ baseURL: 'http://localhost:11434' });
 * console.log(supportsSafetyIdentifier(localClient)); // false
 * ```
 */
export function supportsSafetyIdentifier(client: OpenAI | unknown): boolean {
  if (!client || typeof client !== 'object') {
    return false;
  }

  // Check if this is an Azure OpenAI client by checking the constructor name
  const constructorName = client.constructor?.name;
  if (constructorName === 'AzureOpenAI' || constructorName === 'AsyncAzureOpenAI') {
    return false;
  }

  // Check if using a custom baseURL (local or alternative provider)
  // Try multiple ways to access baseURL as the internal structure may vary
  const clientObj = client as Record<string, unknown>;
  const baseURL: string | undefined =
    (clientObj.baseURL as string) ??
    ((clientObj._client as Record<string, unknown>)?.baseURL as string) ??
    (clientObj._baseURL as string);

  if (baseURL !== undefined && baseURL !== null) {
    const baseURLStr = String(baseURL);
    // Only official OpenAI API endpoints support safety_identifier
    return baseURLStr.includes('api.openai.com');
  }

  // Default OpenAI client (no custom baseURL) supports it
  return true;
}

