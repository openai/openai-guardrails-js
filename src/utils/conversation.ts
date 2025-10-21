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

export interface NormalizedConversationEntry {
  role?: string;
  content?: string | null;
  type?: string | null;
  tool_name?: string | null;
  arguments?: string | null;
  output?: string | null;
  call_id?: string | null;
}

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

export function normalizeConversation(
  conversation: unknown
): NormalizedConversationEntry[] {
  if (conversation == null) {
    return [];
  }

  if (typeof conversation === 'string') {
    return [
      createConversationEntry({
        role: 'user',
        content: conversation,
      }),
    ];
  }

  if (Array.isArray(conversation)) {
    return conversation.flatMap((item) => normalizeItem(item));
  }

  if (typeof conversation === 'object') {
    return normalizeItem(conversation);
  }

  return normalizeItem(conversation);
}

export function appendAssistantResponse(
  conversation: Iterable<NormalizedConversationEntry>,
  llmResponse: unknown
): NormalizedConversationEntry[] {
  const base = Array.from(conversation, (entry) => ({ ...entry }));
  const responseEntries = normalizeModelResponse(llmResponse);
  return base.concat(responseEntries);
}

export function mergeConversationWithItems(
  conversation: Iterable<NormalizedConversationEntry>,
  items: Iterable<unknown>
): NormalizedConversationEntry[] {
  const base = Array.from(conversation, (entry) => ({ ...entry }));
  for (const entry of normalizeSequence(items)) {
    base.push(entry);
  }
  return base;
}

function normalizeSequence(items: Iterable<unknown>): NormalizedConversationEntry[] {
  const normalized: NormalizedConversationEntry[] = [];
  for (const item of items) {
    normalized.push(...normalizeItem(item));
  }
  return normalized;
}

function normalizeItem(item: unknown): NormalizedConversationEntry[] {
  if (item == null) {
    return [];
  }

  if (typeof item === 'string') {
    return [
      createConversationEntry({
        role: 'user',
        content: item,
      }),
    ];
  }

  if (Array.isArray(item)) {
    return item.flatMap((child) => normalizeItem(child));
  }

  if (typeof item === 'object') {
    return normalizeMapping(item as Record<string, unknown>);
  }

  return [
    createConversationEntry({
      content: stringify(item),
    }),
  ];
}

function normalizeMapping(item: Record<string, unknown>): NormalizedConversationEntry[] {
  const record = item as any;
  const itemType = typeof record.type === 'string' ? (record.type as string) : null;

  if (itemType === 'function_call' || itemType === 'tool_call') {
    const fnSection =
      record.function && typeof record.function === 'object' ? (record.function as Record<string, unknown>) : null;
    const argsSource = record.arguments ?? (fnSection ? (fnSection as any).arguments : undefined);

    return [
      createConversationEntry({
        type: 'function_call',
        tool_name: extractToolName(record),
        arguments: stringify(argsSource),
        call_id: stringify(record.call_id ?? record.id),
      }),
    ];
  }

  if (itemType === 'function_call_output') {
    return [
      createConversationEntry({
        type: 'function_call_output',
        tool_name: extractToolName(record),
        arguments: stringify(record.arguments),
        output: stringify(record.output ?? record.content),
        call_id: stringify(record.call_id ?? record.id),
      }),
    ];
  }

  const role = typeof record.role === 'string' ? (record.role as string) : undefined;
  const textContent = extractText(record.content ?? record.text);

  const entry = createConversationEntry({
    role,
    content: textContent,
    type: itemType,
  });

  const toolCalls = Array.isArray(record.tool_calls)
    ? normalizeToolCalls(record.tool_calls as unknown[])
    : [];

  return [entry, ...toolCalls];
}

function normalizeToolCalls(toolCalls: unknown[]): NormalizedConversationEntry[] {
  const entries: NormalizedConversationEntry[] = [];

  for (const call of toolCalls) {
    if (call == null) {
      continue;
    }

    const mapping =
      typeof call === 'object'
        ? (call as Record<string, unknown>)
        : { arguments: call };
    const record = mapping as any;

    const fnSection =
      record.function && typeof record.function === 'object' ? (record.function as Record<string, unknown>) : null;
    const argsSource = record.arguments ?? (fnSection ? (fnSection as any).arguments : undefined);

    entries.push(
      createConversationEntry({
        type: 'function_call',
        tool_name: extractToolName(record),
        arguments: stringify(argsSource),
        call_id: stringify(record.id ?? record.call_id),
      })
    );
  }

  return entries;
}

function normalizeModelResponse(response: unknown): NormalizedConversationEntry[] {
  if (response == null) {
    return [];
  }

  if (typeof response === 'object') {
    const obj = response as any;

    if (Array.isArray(obj.output)) {
      return normalizeSequence(obj.output);
    }

    if (Array.isArray(obj.choices) && obj.choices.length > 0) {
      const choice = obj.choices[0] as any;
      const message = choice.message ?? choice;
      return normalizeItem(message);
    }

    if (obj.delta != null) {
      return normalizeItem(obj.delta);
    }
  }

  return normalizeItem(response);
}

function extractToolName(item: Record<string, unknown>): string | null {
  const record = item as any;
  if (typeof record.tool_name === 'string') {
    return record.tool_name;
  }
  if (typeof record.name === 'string') {
    return record.name;
  }

  const fnSection =
    record.function && typeof record.function === 'object' ? (record.function as Record<string, unknown>) : null;
  if (fnSection && typeof (fnSection as any).name === 'string') {
    return (fnSection as any).name as string;
  }

  return null;
}

function extractText(content: unknown): string | null {
  if (content == null) {
    return null;
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((item) => extractText(item))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return parts.join(' ').trim() || null;
  }

  if (typeof content === 'object') {
    const mapping = content as Record<string, unknown>;
    if (typeof mapping.text === 'string') {
      return mapping.text;
    }
    if ('content' in mapping) {
      return extractText(mapping.content);
    }
  }

  const converted = stringify(content);
  return converted ?? null;
}

function stringify(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createConversationEntry(
  entry: NormalizedConversationEntry
): NormalizedConversationEntry {
  const result: NormalizedConversationEntry = {};

  if (entry.role) {
    result.role = entry.role;
  }
  if (entry.content != null) {
    result.content = entry.content;
  }
  if (entry.type) {
    result.type = entry.type;
  }
  if (entry.tool_name != null) {
    result.tool_name = entry.tool_name;
  }
  if (entry.arguments != null) {
    result.arguments = entry.arguments;
  }
  if (entry.output != null) {
    result.output = entry.output;
  }
  if (entry.call_id != null) {
    result.call_id = entry.call_id;
  }

  return result;
}

export { POSSIBLE_CONVERSATION_KEYS };
