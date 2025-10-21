/**
 * Utilities for parsing OpenAI response items into Entry objects and formatting them.
 *
 * It provides:
 *   - Entry: a record of role and content.
 *   - parseResponseItems: flatten responses into entries with optional filtering.
 *   - formatEntries: render entries as JSON or plain text.
 */

import { OpenAI } from 'openai';
import { TextOnlyMessage } from '../types';

/**
 * Parsed text entry with role metadata.
 */
export interface Entry {
  /** The role of the message (e.g., 'user', 'assistant'). */
  role: string;
  /** The content of the message. */
  content: string;
}

/**
 * Type aliases for OpenAI response types.
 */
export type TResponse = 
  | OpenAI.Completions.Completion
  | OpenAI.Chat.Completions.ChatCompletion
  | OpenAI.Chat.Completions.ChatCompletionChunk
  | OpenAI.Responses.Response;

export type TResponseInputItem = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type TResponseOutputItem = OpenAI.Chat.Completions.ChatCompletionMessage;
export type TResponseStreamEvent = OpenAI.Chat.Completions.ChatCompletionChunk;


/**
 * Parse both input and output messages (type='message').
 */
function parseMessage(item: TextOnlyMessage): Entry[] {
  const role = item.role;
  const contents = item.content;

  if (typeof contents === 'string') {
    return [{ role, content: contents }];
  }

  const parts: string[] = [];
  if (Array.isArray(contents)) {
    // Handle mixed content types (objects and strings)
    for (const part of contents) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (typeof part === 'object' && part !== null && 'text' in part) {
        parts.push(part.text);
      }
      // Skip unknown object types (like { type: 'unknown', foo: 'bar' })
    }
  }

  return [{ role, content: parts.join('') }];
}


/**
 * Parse response items into Entry objects.
 *
 * @param response - The response to parse.
 * @param filterFn - Optional filter function for entries.
 * @returns Array of parsed entries.
 */
export function parseResponseItems(
  response: TResponse,
  filterFn?: (entry: Entry) => boolean
): Entry[] {
  const entries: Entry[] = [];

  if (!response || typeof response !== 'object') {
    return entries;
  }

  // Handle different response types
  if ('choices' in response && response.choices && Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      if ('message' in choice && choice.message && choice.message.content) {
        const messageEntries = parseMessage({
          role: choice.message.role,
          content: choice.message.content
        });
        entries.push(...messageEntries);
      }
    }
  }

  // Apply filter if provided
  if (filterFn) {
    return entries.filter(filterFn);
  }

  return entries;
}

/**
 * Parse response items as JSON.
 *
 * @param response - The response to parse.
 * @returns Array of parsed entries.
 */
export function parseResponseItemsAsJson(response: TResponse): Entry[] {
  return parseResponseItems(response, (entry) => {
    try {
      JSON.parse(entry.content);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Format entries as JSON.
 *
 * @param entries - The entries to format.
 * @returns JSON string representation.
 */
export function formatEntriesAsJson(entries: Entry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Format entries as plain text.
 *
 * @param entries - The entries to format.
 * @returns Plain text representation.
 */
export function formatEntriesAsText(entries: Entry[]): string {
  return entries.map((entry) => `${entry.role}: ${entry.content}`).join('\n');
}

/**
 * Format entries in the specified format.
 *
 * @param entries - The entries to format.
 * @param format - The format to use ('json' or 'text').
 * @param options - Formatting options.
 * @returns Formatted string representation.
 */
export function formatEntries(
  entries: Entry[],
  format: 'json' | 'text' = 'text'
): string {
  switch (format) {
    case 'json':
      return formatEntriesAsJson(entries);
    case 'text':
    default:
      return formatEntriesAsText(entries);
  }
}

/**
 * Extract text content from a response.
 *
 * @param response - The response to extract text from.
 * @returns Extracted text content.
 */
export function extractTextContent(response: TResponse): string {
  const entries = parseResponseItems(response);
  return entries.map((entry) => entry.content).join('\n');
}

/**
 * Extract JSON content from a response.
 *
 * @param response - The response to extract JSON from.
 * @returns Extracted JSON content or null if parsing fails.
 */
export function extractJsonContent(response: TResponse): Record<string, unknown> | null {
  const entries = parseResponseItemsAsJson(response);
  if (entries.length === 0) return null;

  try {
    return JSON.parse(entries[0].content);
  } catch {
    return null;
  }
}
