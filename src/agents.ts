/**
 * GuardrailAgent: Drop-in replacement for Agents SDK Agent with automatic guardrails.
 *
 * This module provides the GuardrailAgent class that acts as a factory for creating
 * Agents SDK Agent instances with guardrails automatically configured from a pipeline
 * configuration file.
 */

import type { AsyncLocalStorage as AsyncLocalStorageType } from 'node:async_hooks';
import type {
  InputGuardrail,
  OutputGuardrail,
  InputGuardrailFunctionArgs,
  OutputGuardrailFunctionArgs,
} from '@openai/agents-core';
import { GuardrailLLMContext, GuardrailResult, TextOnlyContent } from './types';
import { TEXT_CONTENT_TYPES } from './utils/content';
import {
  loadPipelineBundles,
  instantiateGuardrails,
  PipelineConfig,
  GuardrailBundle,
  ConfiguredGuardrail,
} from './runtime';
import {
  mergeConversationWithItems,
  normalizeConversation,
  NormalizedConversationEntry,
} from './utils/conversation';

interface AgentOutput {
  response?: string;
  finalOutput?: string | TextOnlyContent;
  [key: string]: string | TextOnlyContent | undefined;
}

type ConversationSession = {
  getItems?: () => Promise<unknown[]>;
  get_items?: () => Promise<unknown[]>;
};

interface PipelineWithStages extends PipelineConfig {
  pre_flight?: GuardrailBundle;
  input?: GuardrailBundle;
  output?: GuardrailBundle;
}

interface AgentConversationContext {
  session: ConversationSession | null;
  fallbackConversation: NormalizedConversationEntry[] | null;
  cachedConversation: NormalizedConversationEntry[] | null;
}

let asyncConversationStorage: AsyncLocalStorageType<AgentConversationContext> | null = null;
let fallbackConversationContext: AgentConversationContext | null = null;

try {
  const asyncHooks: typeof import('node:async_hooks') = require('node:async_hooks');
  asyncConversationStorage = new asyncHooks.AsyncLocalStorage<AgentConversationContext>();
} catch {
  asyncConversationStorage = null;
}

function runWithConversationContext<T>(context: AgentConversationContext, fn: () => T): T {
  if (asyncConversationStorage) {
    return asyncConversationStorage.run(context, fn);
  }

  const previous = fallbackConversationContext;
  fallbackConversationContext = context;
  try {
    return fn();
  } finally {
    fallbackConversationContext = previous;
  }
}

function getConversationContext(): AgentConversationContext | null {
  if (asyncConversationStorage) {
    return asyncConversationStorage.getStore() ?? null;
  }
  return fallbackConversationContext;
}

function cloneEntries(
  entries: NormalizedConversationEntry[] | null | undefined
): NormalizedConversationEntry[] {
  return entries ? entries.map((entry) => ({ ...entry })) : [];
}

function cacheConversation(conversation: NormalizedConversationEntry[]): void {
  const context = getConversationContext();
  if (context) {
    context.cachedConversation = cloneEntries(conversation);
  }
}

async function fetchSessionItems(
  session: ConversationSession | null | undefined
): Promise<unknown[]> {
  if (!session) {
    return [];
  }

  if (typeof session.getItems === 'function') {
    return session.getItems();
  }

  if (typeof session.get_items === 'function') {
    return session.get_items();
  }

  return [];
}

async function loadAgentConversation(): Promise<NormalizedConversationEntry[]> {
  const context = getConversationContext();
  if (!context) {
    return [];
  }

  if (context.cachedConversation) {
    return cloneEntries(context.cachedConversation);
  }

  const sessionItems = await fetchSessionItems(context.session);
  if (sessionItems.length > 0) {
    const normalized = normalizeConversation(sessionItems);
    cacheConversation(normalized);
    return cloneEntries(normalized);
  }

  if (context.fallbackConversation) {
    cacheConversation(context.fallbackConversation);
    return cloneEntries(context.fallbackConversation);
  }

  return [];
}

function entriesEqual(
  a: NormalizedConversationEntry | undefined,
  b: NormalizedConversationEntry | undefined
): boolean {
  if (!a || !b) {
    return false;
  }

  return (
    a.role === b.role &&
    a.type === b.type &&
    a.content === b.content &&
    a.tool_name === b.tool_name &&
    a.arguments === b.arguments &&
    a.output === b.output &&
    a.call_id === b.call_id
  );
}

async function ensureConversationIncludes(
  items: NormalizedConversationEntry[]
): Promise<NormalizedConversationEntry[]> {
  if (items.length === 0) {
    return loadAgentConversation();
  }

  const base = await loadAgentConversation();
  const baseLength = base.length;
  const itemsLength = items.length;

  let needsMerge = true;

  if (baseLength >= itemsLength && itemsLength > 0) {
    needsMerge = false;
    for (let i = 0; i < itemsLength; i += 1) {
      if (!entriesEqual(base[baseLength - itemsLength + i], items[i])) {
        needsMerge = true;
        break;
      }
    }
  }

  if (!needsMerge) {
    return base;
  }

  const merged = mergeConversationWithItems(base, items);
  cacheConversation(merged);
  return merged;
}

function createConversationContext(
  baseContext: GuardrailLLMContext,
  conversation: NormalizedConversationEntry[]
): GuardrailLLMContext & { getConversationHistory: () => NormalizedConversationEntry[] } {
  const historySnapshot = cloneEntries(conversation);
  const guardrailContext: GuardrailLLMContext & {
    getConversationHistory?: () => NormalizedConversationEntry[];
  } = {
    ...baseContext,
  };

  guardrailContext.getConversationHistory = () => cloneEntries(historySnapshot);
  return guardrailContext as GuardrailLLMContext & {
    getConversationHistory: () => NormalizedConversationEntry[];
  };
}

function normalizeAgentInput(input: unknown): NormalizedConversationEntry[] {
  return normalizeConversation(input);
}

function normalizeAgentOutput(outputText: string): NormalizedConversationEntry[] {
  if (!outputText) {
    return [];
  }
  return normalizeConversation([{ role: 'assistant', content: outputText }]);
}

function hasGuardrailLlm(value: unknown): value is GuardrailLLMContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'guardrailLlm' in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>).guardrailLlm != null
  );
}

function ensureGuardrailContext(
  providedContext: GuardrailLLMContext | undefined,
  agentContext: unknown
): GuardrailLLMContext {
  if (providedContext?.guardrailLlm) {
    return providedContext;
  }

  if (hasGuardrailLlm(agentContext)) {
    return agentContext;
  }

  const { OpenAI } = require('openai');
  const base =
    typeof agentContext === 'object' && agentContext !== null
      ? (agentContext as Record<string, unknown>)
      : {};

  return {
    ...base,
    guardrailLlm: new OpenAI(),
  } as GuardrailLLMContext;
}

const TEXTUAL_CONTENT_TYPES = new Set<string>(TEXT_CONTENT_TYPES);
const MAX_CONTENT_EXTRACTION_DEPTH = 10;

/**
 * Extract text from any nested content value with optional type filtering.
 *
 * @param value Arbitrary content value (string, array, or object) to inspect.
 * @param depth Current recursion depth, used to guard against circular structures.
 * @param filterByType When true, only content parts with recognized text types are returned.
 * @returns The extracted text, or an empty string when no text is found.
 */
function extractTextFromValue(value: unknown, depth: number, filterByType: boolean): string {
  if (depth > MAX_CONTENT_EXTRACTION_DEPTH) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const text = extractTextFromValue(item, depth + 1, filterByType);
      if (text) {
        parts.push(text);
      }
    }
    return parts.join(' ').trim();
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const typeValue = typeof record.type === 'string' ? record.type : null;
    const isRecognizedTextType = typeValue ? TEXTUAL_CONTENT_TYPES.has(typeValue) : false;

    if (typeof record.text === 'string') {
      if (!filterByType || isRecognizedTextType || typeValue === null) {
        return record.text.trim();
      }
    }

    const contentValue = record.content;
    // If a direct text field was skipped due to type filtering, fall back to nested content.
    if (contentValue != null) {
      const nested = extractTextFromValue(contentValue, depth + 1, filterByType);
      if (nested) {
        return nested;
      }
    }
  }

  return '';
}

/**
 * Extract text from structured content parts (e.g., the `content` field on a message).
 *
 * Only textual content-part types enumerated in TEXTUAL_CONTENT_TYPES are considered so
 * that non-text modalities (images, tools, etc.) remain ignored.
 */
function extractTextFromContentParts(content: unknown, depth = 0): string {
  return extractTextFromValue(content, depth, true);
}

/**
 * Extract text from a single message entry.
 *
 * Handles strings, arrays of content parts, or message-like objects that contain a
 * `content` collection or a plain `text` field.
 */
function extractTextFromMessageEntry(entry: unknown, depth = 0): string {
  if (depth > MAX_CONTENT_EXTRACTION_DEPTH) {
    return '';
  }

  if (entry == null) {
    return '';
  }

  if (typeof entry === 'string') {
    return entry.trim();
  }

  if (Array.isArray(entry)) {
    return extractTextFromContentParts(entry, depth + 1);
  }

  if (typeof entry === 'object') {
    const record = entry as Record<string, unknown>;

    if (record.content !== undefined) {
      const contentText = extractTextFromContentParts(record.content, depth + 1);
      if (contentText) {
        return contentText;
      }
    }

    if (typeof record.text === 'string') {
      return record.text.trim();
    }
  }

  return extractTextFromValue(entry, depth + 1, false /* allow all types when falling back */);
}

/**
 * Extract the latest user-authored text from raw agent input.
 *
 * Accepts strings, message objects, or arrays of mixed items. Arrays are scanned
 * from newest to oldest, returning the first user-role message with textual content.
 */
function extractTextFromAgentInput(input: unknown): string {
  if (input == null) {
    return '';
  }

  if (typeof input === 'string') {
    return input.trim();
  }

  if (Array.isArray(input)) {
    for (let idx = input.length - 1; idx >= 0; idx -= 1) {
      const candidate = input[idx];
      if (candidate && typeof candidate === 'object') {
        const record = candidate as Record<string, unknown>;
        if (record.role === 'user') {
          const text = extractTextFromMessageEntry(candidate);
          if (text) {
            return text;
          }
        }
      } else if (typeof candidate === 'string') {
        const text = candidate.trim();
        if (text) {
          return text;
        }
      }
    }
    return '';
  }

  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (record.role === 'user') {
      const text = extractTextFromMessageEntry(record);
      if (text) {
        return text;
      }
    }

    if (record.content != null) {
      const contentText = extractTextFromContentParts(record.content);
      if (contentText) {
        return contentText;
      }
    }

    if (typeof record.text === 'string') {
      return record.text.trim();
    }
  }

  if (
    typeof input === 'number' ||
    typeof input === 'boolean' ||
    typeof input === 'bigint'
  ) {
    return String(input);
  }

  return '';
}

function extractLatestUserText(history: NormalizedConversationEntry[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry.role === 'user' && typeof entry.content === 'string' && entry.content.trim()) {
      return entry.content;
    }
  }
  return '';
}

function resolveInputText(input: unknown, history: NormalizedConversationEntry[]): string {
  const directText = extractTextFromAgentInput(input);
  if (directText) {
    return directText;
  }

  return extractLatestUserText(history);
}

function resolveOutputText(agentOutput: unknown): string {
  if (typeof agentOutput === 'string') {
    return agentOutput;
  }

  if (agentOutput && typeof agentOutput === 'object') {
    if ('response' in agentOutput) {
      return (agentOutput as AgentOutput).response || '';
    }
    if ('finalOutput' in agentOutput) {
      const finalOutput = (agentOutput as AgentOutput).finalOutput;
      return typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput);
    }
  }

  return typeof agentOutput === 'object' ? JSON.stringify(agentOutput) : '';
}

let agentRunnerPatched = false;

function ensureAgentRunnerPatch(): void {
  if (agentRunnerPatched) {
    return;
  }

  try {
    const agentsCore = require('@openai/agents-core');
    const { Runner } = agentsCore ?? {};

    if (!Runner || typeof Runner.prototype?.run !== 'function') {
      agentRunnerPatched = true;
      return;
    }

    const originalRun = Runner.prototype.run;

    Runner.prototype.run = function patchedRun(
      agent: unknown,
      input: unknown,
      options?: Record<string, unknown>
    ) {
      const normalizedOptions = options ?? {};
      const sessionCandidate = normalizedOptions.session;
      const session: ConversationSession | null =
        typeof sessionCandidate === 'object' && sessionCandidate !== null
          ? (sessionCandidate as ConversationSession)
          : null;
      const fallbackConversation = session ? [] : normalizeConversation(input);
      const normalizedFallback =
        fallbackConversation.length > 0 ? cloneEntries(fallbackConversation) : null;

      const context: AgentConversationContext = {
        session,
        fallbackConversation: normalizedFallback,
        cachedConversation: normalizedFallback,
      };

      return runWithConversationContext(context, () =>
        originalRun.call(this, agent, input, normalizedOptions)
      );
    };

    agentRunnerPatched = true;
  } catch {
    agentRunnerPatched = true;
  }
}

/**
 * Drop-in replacement for Agents SDK Agent with automatic guardrails integration.
 *
 * This class acts as a factory that creates a regular Agents SDK Agent instance
 * with guardrails automatically configured from a pipeline configuration.
 */
export class GuardrailAgent {
  static async create(
    config: string | PipelineConfig,
    name: string,
    instructions?: string | ((context: unknown, agent: unknown) => string | Promise<string>),
    agentKwargs: Record<string, unknown> = {},
    raiseGuardrailErrors: boolean = false
  ): Promise<unknown> {
    ensureAgentRunnerPatch();

    try {
      const agentsModule = await import('@openai/agents');
      const { Agent } = agentsModule;

      const pipeline = (await loadPipelineBundles(config)) as PipelineWithStages;

      // Extract any user-provided guardrails from agentKwargs
      const userInputGuardrails = agentKwargs.inputGuardrails as InputGuardrail[] | undefined;
      const userOutputGuardrails = agentKwargs.outputGuardrails as OutputGuardrail[] | undefined;

      // Remove them from agentKwargs to avoid duplication
      const filteredAgentKwargs = { ...agentKwargs };
      delete filteredAgentKwargs.inputGuardrails;
      delete filteredAgentKwargs.outputGuardrails;

      // Create agent-level INPUT guardrails from config
      const inputGuardrails: InputGuardrail[] = [];
      if (pipeline.pre_flight) {
        const preFlightGuardrails = await createInputGuardrailsFromStage(
          'pre_flight',
          pipeline.pre_flight,
          undefined,
          raiseGuardrailErrors
        );
        inputGuardrails.push(...preFlightGuardrails);
      }
      if (pipeline.input) {
        const inputStageGuardrails = await createInputGuardrailsFromStage(
          'input',
          pipeline.input,
          undefined,
          raiseGuardrailErrors
        );
        inputGuardrails.push(...inputStageGuardrails);
      }

      // Merge with user-provided input guardrails (config ones run first, then user ones)
      if (userInputGuardrails && Array.isArray(userInputGuardrails)) {
        inputGuardrails.push(...userInputGuardrails);
      }

      // Create agent-level OUTPUT guardrails from config
      const outputGuardrails: OutputGuardrail[] = [];
      if (pipeline.output) {
        const outputStageGuardrails = await createOutputGuardrailsFromStage(
          'output',
          pipeline.output,
          undefined,
          raiseGuardrailErrors
        );
        outputGuardrails.push(...outputStageGuardrails);
      }

      // Merge with user-provided output guardrails (config ones run first, then user ones)
      if (userOutputGuardrails && Array.isArray(userOutputGuardrails)) {
        outputGuardrails.push(...userOutputGuardrails);
      }

      return new Agent({
        name,
        instructions,
        inputGuardrails,
        outputGuardrails,
        ...filteredAgentKwargs,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cannot resolve module')) {
        throw new Error(
          'The @openai/agents package is required to use GuardrailAgent. ' +
            'Please install it with: npm install @openai/agents'
        );
      }
      throw error;
    }
  }
}

async function createInputGuardrailsFromStage(
  stageName: string,
  stageConfig: GuardrailBundle,
  context?: GuardrailLLMContext,
  raiseGuardrailErrors: boolean = false
): Promise<InputGuardrail[]> {
  const guardrails: ConfiguredGuardrail[] = await instantiateGuardrails(stageConfig);

  return guardrails.map((guardrail: ConfiguredGuardrail) => ({
    name: `${stageName}: ${guardrail.definition.name || 'Unknown Guardrail'}`,
    execute: async (args: InputGuardrailFunctionArgs) => {
      const { input, context: agentContext } = args;

      try {
        const guardContext = ensureGuardrailContext(context, agentContext);

        const normalizedItems = normalizeAgentInput(input);
        const conversationHistory = await ensureConversationIncludes(normalizedItems);
        const ctxWithConversation = createConversationContext(guardContext, conversationHistory);
        const inputText = resolveInputText(input, conversationHistory);

        const result: GuardrailResult = await guardrail.run(ctxWithConversation, inputText);

        if (raiseGuardrailErrors && result.executionFailed) {
          throw result.originalException;
        }

        return {
          outputInfo: {
            ...(result.info || {}),
            input: inputText,
          },
          tripwireTriggered: result.tripwireTriggered || false,
        };
      } catch (error) {
        if (raiseGuardrailErrors) {
          throw error;
        }
        return {
          outputInfo: {
            error: error instanceof Error ? error.message : String(error),
            guardrail_name: guardrail.definition.name || 'unknown',
            input: typeof input === 'string' ? input : JSON.stringify(input),
          },
          tripwireTriggered: false,
        };
      }
    },
  }));
}

async function createOutputGuardrailsFromStage(
  stageName: string,
  stageConfig: GuardrailBundle,
  context?: GuardrailLLMContext,
  raiseGuardrailErrors: boolean = false
): Promise<OutputGuardrail[]> {
  const guardrails: ConfiguredGuardrail[] = await instantiateGuardrails(stageConfig);

  return guardrails.map((guardrail: ConfiguredGuardrail) => ({
    name: `${stageName}: ${guardrail.definition.name || 'Unknown Guardrail'}`,
    execute: async (args: OutputGuardrailFunctionArgs) => {
      const { agentOutput, context: agentContext } = args;

      try {
        const guardContext = ensureGuardrailContext(context, agentContext);

        const outputText = resolveOutputText(agentOutput);
        const normalizedItems = normalizeAgentOutput(outputText);
        const conversationHistory = await ensureConversationIncludes(normalizedItems);
        const ctxWithConversation = createConversationContext(guardContext, conversationHistory);

        const result: GuardrailResult = await guardrail.run(ctxWithConversation, outputText);

        if (raiseGuardrailErrors && result.executionFailed) {
          throw result.originalException;
        }

        return {
          outputInfo: {
            ...(result.info || {}),
            input: outputText,
          },
          tripwireTriggered: result.tripwireTriggered || false,
        };
      } catch (error) {
        if (raiseGuardrailErrors) {
          throw error;
        }
        return {
          outputInfo: {
            error: error instanceof Error ? error.message : String(error),
            guardrail_name: guardrail.definition.name || 'unknown',
            input:
              typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput, null, 2),
          },
          tripwireTriggered: false,
        };
      }
    },
  }));
}
