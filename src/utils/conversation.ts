const POSSIBLE_CONVERSATION_KEYS = [
  'messages',
  'conversation',
  'conversation_history',
  'conversationHistory',
  'recent_messages',
  'recentMessages',
  'turns',
  'output',
  'outputs',
] as const;

/**
 * Parse conversation-like input into a flat list of message objects.
 *
 * Accepts raw JSON strings, arrays, or objects that embed conversation arrays under
 * several common keys. Returns an empty array when no conversation data is found.
 */
export function parseConversationInput(rawInput: unknown): unknown[] {
  if (Array.isArray(rawInput)) {
    return rawInput;
  }

  if (rawInput == null) {
    return [];
  }

  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return parseConversationInput(parsed);
    } catch {
      return [];
    }
  }

  if (typeof rawInput === 'object') {
    for (const key of POSSIBLE_CONVERSATION_KEYS) {
      const value = (rawInput as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value;
      }
      if (value && typeof value === 'object') {
        const nested = parseConversationInput(value);
        if (nested.length > 0) {
          return nested;
        }
      }
    }
  }

  return [];
}

export { POSSIBLE_CONVERSATION_KEYS };
