/**
 * GuardrailAgent: Drop-in replacement for Agents SDK Agent with automatic guardrails.
 *
 * This module provides the GuardrailAgent class that acts as a factory for creating
 * Agents SDK Agent instances with guardrails automatically configured from a pipeline
 * configuration file.
 */

import type { AsyncLocalStorage as AsyncLocalStorageType } from 'node:async_hooks';
import { GuardrailLLMContext } from './types';
import { loadPipelineBundles, instantiateGuardrails, PipelineConfig, GuardrailBundle } from './runtime';
import {
  mergeConversationWithItems,
  normalizeConversation,
  NormalizedConversationEntry,
} from './utils/conversation';

type ConversationSession = {
  getItems?: () => Promise<any[]>;
  get_items?: () => Promise<any[]>;
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

function cloneEntries(entries: NormalizedConversationEntry[] | null | undefined): NormalizedConversationEntry[] {
  return entries ? entries.map((entry) => ({ ...entry })) : [];
}

function cacheConversation(conversation: NormalizedConversationEntry[]): void {
  const context = getConversationContext();
  if (context) {
    context.cachedConversation = cloneEntries(conversation);
  }
}

async function fetchSessionItems(session: ConversationSession | null | undefined): Promise<any[]> {
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

function normalizeAgentInput(input: string | unknown): NormalizedConversationEntry[] {
  return normalizeConversation(input);
}

function normalizeAgentOutput(outputText: string): NormalizedConversationEntry[] {
  return normalizeConversation([{ role: 'assistant', content: outputText }]);
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

    Runner.prototype.run = function patchedRun(agent: any, input: any, options: any = {}) {
      const session: ConversationSession | null = options?.session ?? null;
      const fallbackConversation = session ? [] : normalizeConversation(input);
      const normalizedFallback =
        fallbackConversation.length > 0 ? cloneEntries(fallbackConversation) : null;

      const context: AgentConversationContext = {
        session,
        fallbackConversation: normalizedFallback,
        cachedConversation: normalizedFallback,
      };

      return runWithConversationContext(context, () => originalRun.call(this, agent, input, options));
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
    instructions: string,
    agentKwargs: Record<string, any> = {},
    raiseGuardrailErrors: boolean = false
  ): Promise<any> {
    ensureAgentRunnerPatch();

    try {
      const agentsModule = await import('@openai/agents');
      const { Agent } = agentsModule;

      const pipeline = await loadPipelineBundles(config) as PipelineWithStages;

      const inputGuardrails = [];
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

      const outputGuardrails = [];
      if (pipeline.output) {
        const outputStageGuardrails = await createOutputGuardrailsFromStage(
          'output',
          pipeline.output,
          undefined,
          raiseGuardrailErrors
        );
        outputGuardrails.push(...outputStageGuardrails);
      }

      return new Agent({
        name,
        instructions,
        inputGuardrails,
        outputGuardrails,
        ...agentKwargs,
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
  stageConfig: any,
  context?: GuardrailLLMContext,
  raiseGuardrailErrors: boolean = false
): Promise<any[]> {
  const guardrails = await instantiateGuardrails(stageConfig);

  return guardrails.map((guardrail: any) => ({
    name: `${stageName}: ${guardrail.name || guardrail.definition?.name || 'Unknown Guardrail'}`,
    execute: async ({ input, context: agentContext }: { input: string; context?: any }) => {
      try {
        let guardContext: GuardrailLLMContext = (context ||
          agentContext || {}) as GuardrailLLMContext;

        if (!guardContext.guardrailLlm) {
          const { OpenAI } = require('openai');
          guardContext = {
            ...guardContext,
            guardrailLlm: new OpenAI(),
          };
        }

        const inputConversationItems = normalizeAgentInput(input);
        const conversationHistory = await ensureConversationIncludes(inputConversationItems);
        const ctxWithConversation = createConversationContext(guardContext, conversationHistory);

        // Extract the latest user message text for guardrails that need text input
        // (e.g., moderation, custom prompt checks)
        let textToCheck = '';
        if (typeof input === 'string') {
          textToCheck = input;
        } else {
          // Find the latest user message in the conversation
          for (let i = conversationHistory.length - 1; i >= 0; i--) {
            const entry = conversationHistory[i];
            if (entry.role === 'user' && entry.content) {
              textToCheck = entry.content;
              break;
            }
          }
        }

        const result = await guardrail.run(ctxWithConversation, textToCheck);

        // If execution failed, handle according to raiseGuardrailErrors flag
        if (result.executionFailed) {
          if (raiseGuardrailErrors) {
            throw result.originalException;
          }
          // Execution failed but not raising errors - return safe result
          return {
            outputInfo: {
              error: result.originalException?.message || 'Guardrail execution failed',
              guardrail_name: guardrail.name || 'unknown',
            },
            tripwireTriggered: false,
          };
        }

        // Return the guardrail result - Agents SDK will handle tripwire exceptions
        return {
          outputInfo: result.info || null,
          tripwireTriggered: result.tripwireTriggered || false,
        };
      } catch (error) {
        // Unexpected error during guardrail execution
        if (raiseGuardrailErrors) {
          throw error;
        }
        return {
          outputInfo: {
            error: error instanceof Error ? error.message : String(error),
            guardrail_name: guardrail.name || 'unknown',
          },
          tripwireTriggered: false,
        };
      }
    },
  }));
}

async function createOutputGuardrailsFromStage(
  stageName: string,
  stageConfig: any,
  context?: GuardrailLLMContext,
  raiseGuardrailErrors: boolean = false
): Promise<any[]> {
  const guardrails = await instantiateGuardrails(stageConfig);

  return guardrails.map((guardrail: any) => ({
    name: `${stageName}: ${guardrail.name || guardrail.definition?.name || 'Unknown Guardrail'}`,
    execute: async ({
      agentOutput,
      context: agentContext,
    }: {
      agentOutput: any;
      context?: any;
    }) => {
      try {
        let outputText = '';
        if (typeof agentOutput === 'string') {
          outputText = agentOutput;
        } else if (agentOutput?.response) {
          outputText = agentOutput.response;
        } else if (agentOutput?.finalOutput) {
          outputText =
            typeof agentOutput.finalOutput === 'string'
              ? agentOutput.finalOutput
              : JSON.stringify(agentOutput.finalOutput);
        } else {
          outputText = JSON.stringify(agentOutput);
        }

        let guardContext: GuardrailLLMContext = (context ||
          agentContext || {}) as GuardrailLLMContext;
        if (!guardContext.guardrailLlm) {
          const { OpenAI } = require('openai');
          guardContext = {
            ...guardContext,
            guardrailLlm: new OpenAI(),
          };
        }

        const outputConversationItems = normalizeAgentOutput(outputText);
        const conversationHistory = await ensureConversationIncludes(outputConversationItems);
        const ctxWithConversation = createConversationContext(guardContext, conversationHistory);

        const result = await guardrail.run(ctxWithConversation, outputText);

        // If execution failed, handle according to raiseGuardrailErrors flag
        if (result.executionFailed) {
          if (raiseGuardrailErrors) {
            throw result.originalException;
          }
          // Execution failed but not raising errors - return safe result
          return {
            outputInfo: {
              error: result.originalException?.message || 'Guardrail execution failed',
              guardrail_name: guardrail.name || 'unknown',
            },
            tripwireTriggered: false,
          };
        }

        // Return the guardrail result - Agents SDK will handle tripwire exceptions
        return {
          outputInfo: result.info || null,
          tripwireTriggered: result.tripwireTriggered || false,
        };
      } catch (error) {
        // Unexpected error during guardrail execution
        if (raiseGuardrailErrors) {
          throw error;
        }
        return {
          outputInfo: {
            error: error instanceof Error ? error.message : String(error),
            guardrail_name: guardrail.name || 'unknown',
          },
          tripwireTriggered: false,
        };
      }
    },
  }));
}
