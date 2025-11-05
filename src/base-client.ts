/**
 * Base client functionality for guardrails integration.
 *
 * This module contains the shared base class and data structures used by both
 * async and sync guardrails clients.
 */

import { OpenAI, AzureOpenAI } from 'openai';
import { GuardrailResult, GuardrailLLMContext, Message, ContentPart, TextContentPart } from './types';
import { ContentUtils } from './utils/content';
import {
  GuardrailBundle,
  ConfiguredGuardrail,
  instantiateGuardrails,
} from './runtime';
import {
  appendAssistantResponse,
  normalizeConversation,
  NormalizedConversationEntry,
} from './utils/conversation';

const ZERO_WIDTH_CHARACTERS = /(?:\u200B|\u200C|\u200D|\u2060|\uFEFF)/g;

type UnknownFunction = (...args: unknown[]) => unknown;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function getRecord(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!record) {
    return null;
  }
  return toRecord(record[key]);
}

function getFunction(record: Record<string, unknown> | null, key: string): UnknownFunction | null {
  if (!record) {
    return null;
  }
  const candidate = record[key];
  return typeof candidate === 'function' ? (candidate as UnknownFunction) : null;
}

interface AsyncIterableLike {
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const iterator = (value as AsyncIterableLike)[Symbol.asyncIterator];
  return typeof iterator === 'function';
}

// Type alias for OpenAI response types
export type OpenAIResponseType =
  | OpenAI.Completions.Completion
  | OpenAI.Chat.Completions.ChatCompletion
  | OpenAI.Chat.Completions.ChatCompletionChunk
  | OpenAI.Responses.Response;

/**
 * Organized guardrail results by pipeline stage.
 */
export interface GuardrailResults {
  preflight: GuardrailResult[];
  input: GuardrailResult[];
  output: GuardrailResult[];
  readonly allResults: GuardrailResult[];
  readonly tripwiresTriggered: boolean;
  readonly triggeredResults: GuardrailResult[];
}

/**
 * Extension of GuardrailResults with convenience methods.
 */
export class GuardrailResultsImpl implements GuardrailResults {
  constructor(
    public preflight: GuardrailResult[],
    public input: GuardrailResult[],
    public output: GuardrailResult[]
  ) {}

  get allResults(): GuardrailResult[] {
    return [...this.preflight, ...this.input, ...this.output];
  }

  get tripwiresTriggered(): boolean {
    return this.allResults.some((r) => r.tripwireTriggered);
  }

  get triggeredResults(): GuardrailResult[] {
    return this.allResults.filter((r) => r.tripwireTriggered);
  }
}

/**
 * Wrapper around any OpenAI response with guardrail results.
 */
export type GuardrailsResponse<T extends OpenAIResponseType = OpenAIResponseType> = T & {
  guardrail_results: GuardrailResults;
};

/**
 * Pipeline configuration structure.
 */
export interface PipelineConfig {
  version?: number;
  pre_flight?: GuardrailBundle;
  input?: GuardrailBundle;
  output?: GuardrailBundle;
}

/**
 * Stage guardrails mapping.
 */
export interface StageGuardrails {
  pre_flight: ConfiguredGuardrail[];
  input: ConfiguredGuardrail[];
  output: ConfiguredGuardrail[];
}

/**
 * Base class with shared functionality for guardrails clients.
 */
export abstract class GuardrailsBaseClient {
  protected pipeline!: PipelineConfig;
  protected guardrails!: StageGuardrails;
  protected context!: GuardrailLLMContext;
  protected _resourceClient!: OpenAI;
  public raiseGuardrailErrors = false;

  /**
   * Extract the latest user text message from a conversation for text guardrails.
   *
   * This method specifically extracts text content from messages. For other content types,
   * create parallel methods like extractLatestUserImage() or extractLatestUserVideo().
   */
  public extractLatestUserTextMessage(messages: Message[]): [string, number] {
    const textOnlyMessages = ContentUtils.filterToTextOnly(messages);

    for (let i = textOnlyMessages.length - 1; i >= 0; i -= 1) {
      const message = textOnlyMessages[i];
      if (message.role === 'user') {
        const text = ContentUtils.extractTextFromMessage(message);
        if (text) {
          return [text, i];
        }
      }
    }

    return ['', -1];
  }

  protected createGuardrailsResponse<T extends OpenAIResponseType>(
    llmResponse: T,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    outputResults: GuardrailResult[]
  ): GuardrailsResponse<T> {
    const guardrailResults = new GuardrailResultsImpl(
      preflightResults,
      inputResults,
      outputResults
    );
    return {
      ...llmResponse,
      guardrail_results: guardrailResults,
    };
  }

  protected async setupGuardrails(
    config: string | PipelineConfig,
    context?: GuardrailLLMContext
  ): Promise<void> {
    this.pipeline = await this.loadPipelineBundles(config);
    this.guardrails = await this.instantiateAllGuardrails();
    this.context = context || this.createDefaultContext();
    this.validateContext(this.context);
  }

  public applyPreflightModifications(
    data: Message[] | string,
    preflightResults: GuardrailResult[]
  ): Message[] | string {
    if (preflightResults.length === 0) {
      return data;
    }

    const piiMappings: Record<string, string> = {};
    let maskedTextOverride: string | undefined;
    for (const result of preflightResults) {
      if (result.info && 'detected_entities' in result.info) {
        const detected = result.info.detected_entities as Record<string, string[]>;
        for (const [entityType, entities] of Object.entries(detected)) {
          for (const entity of entities) {
            piiMappings[entity] = `<${entityType}>`;
          }
        }
        if (typeof result.info.checked_text === 'string' && !maskedTextOverride) {
          maskedTextOverride = result.info.checked_text;
        }
      }
    }

    if (!maskedTextOverride && Object.keys(piiMappings).length === 0) {
      return data;
    }

    const normalizeForMasking = (text: string): string =>
      text.normalize('NFKC').replace(ZERO_WIDTH_CHARACTERS, '');

    const originalStringData = typeof data === 'string' ? data : undefined;

    const maskText = (text: string): string => {
      if (typeof text !== 'string') {
        return text as unknown as string;
      }

      const hasMappings = Object.keys(piiMappings).length > 0;
      const normalizedOriginal = normalizeForMasking(text);
      let maskedText = normalizedOriginal;
      const sortedPii = Object.entries(piiMappings).sort((a, b) => b[0].length - a[0].length);

      if (hasMappings) {
        for (const [originalPii, maskedToken] of sortedPii) {
          const normalizedKey = normalizeForMasking(originalPii);
          if (normalizedKey && maskedText.includes(normalizedKey)) {
            maskedText = maskedText.split(normalizedKey).join(maskedToken);
          }
        }
      }

      const replacementsApplied = hasMappings && maskedText !== normalizedOriginal;

      if (replacementsApplied) {
        return maskedText;
      }

      if (maskedTextOverride && originalStringData !== undefined && text === originalStringData) {
        return maskedTextOverride;
      }

      return text;
    };

    if (typeof data === 'string') {
      return maskText(data);
    }

    const [, latestUserIdx] = this.extractLatestUserTextMessage(data);
    if (latestUserIdx === -1) {
      return data;
    }

    const modifiedMessages = [...data];
    const currentContent = data[latestUserIdx].content;
    let modifiedContent: string | ContentPart[];

    if (typeof currentContent === 'string') {
      modifiedContent = maskText(currentContent);
    } else if (Array.isArray(currentContent)) {
      modifiedContent = currentContent.map((part) => {
        if (ContentUtils.isText(part)) {
          const textPart = part as TextContentPart;
          return { ...textPart, text: maskText(textPart.text) };
        }
        return part;
      });
    } else {
      return data;
    }

    if (modifiedContent !== currentContent) {
      modifiedMessages[latestUserIdx] = {
        ...modifiedMessages[latestUserIdx],
        content: modifiedContent,
      };
    }

    return modifiedMessages;
  }

  protected async instantiateAllGuardrails(): Promise<StageGuardrails> {
    const guardrails: StageGuardrails = {
      pre_flight: [],
      input: [],
      output: [],
    };

    for (const stageName of ['pre_flight', 'input', 'output'] as const) {
      const stage = this.pipeline[stageName];
      guardrails[stageName] = stage ? await instantiateGuardrails(stage) : [];
    }

    return guardrails;
  }

  protected validateContext(context: GuardrailLLMContext): void {
    if (!context.guardrailLlm) {
      throw new Error('Context must have a guardrailLlm property');
    }
  }

  protected extractResponseText(response: OpenAIResponseType): string {
    if ('output' in response) {
      return response.output_text || '';
    }

    if ('choices' in response && response.choices) {
      const choice0 = response.choices[0];

      if ('message' in choice0 && choice0.message) {
        return choice0.message.content || '';
      }

      if ('text' in choice0 && choice0.text) {
        return choice0.text;
      }

      if ('delta' in choice0 && choice0.delta) {
        return choice0.delta.content || '';
      }
    }

    return '';
  }

  protected async loadPipelineBundles(config: string | PipelineConfig): Promise<PipelineConfig> {
    const { loadPipelineBundles } = await import('./runtime.js');
    return loadPipelineBundles(config);
  }

  protected abstract createDefaultContext(): GuardrailLLMContext;

  public async initializeClient(
    config: string | PipelineConfig,
    openaiArgs: ConstructorParameters<typeof OpenAI>[0],
    clientClass: typeof OpenAI | typeof AzureOpenAI
  ): Promise<void> {
    this._resourceClient = new clientClass(openaiArgs);
    await this.setupGuardrails(config);
    this.overrideResources();
  }

  protected abstract overrideResources(): void;

  private shouldRunGuardrail(guardrail: ConfiguredGuardrail, detectedContentType: string): boolean {
    return guardrail.definition.mediaType === detectedContentType;
  }

  public async runStageGuardrails(
    stageName: 'pre_flight' | 'input' | 'output',
    text: string,
    conversationHistory?: unknown,
    suppressTripwire: boolean = false,
    raiseGuardrailErrors: boolean = false
  ): Promise<GuardrailResult[]> {
    if (!this.guardrails?.[stageName] || this.guardrails[stageName].length === 0) {
      return [];
    }

    try {
      const detectedContentType = 'text/plain';

      const compatibleGuardrails = this.guardrails[stageName].filter((guardrail) =>
        this.shouldRunGuardrail(guardrail, detectedContentType)
      );

      const skippedGuardrails = this.guardrails[stageName].filter(
        (guardrail) => !this.shouldRunGuardrail(guardrail, detectedContentType)
      );

      if (skippedGuardrails.length > 0) {
        console.warn(
          `⚠️  Guardrails Warning: ${skippedGuardrails.length} guardrails skipped due to content type mismatch ` +
            `(detected: ${detectedContentType}). Skipped: ${skippedGuardrails
              .map((g) => g.definition.name)
              .join(', ')}`
        );
      }

      if (compatibleGuardrails.length === 0) {
        console.warn(
          `No guardrails compatible with content type '${detectedContentType}' for stage '${stageName}'`
        );
        return [];
      }

      const needsConversationHistory = compatibleGuardrails.some(
        (guardrail) => guardrail.definition.metadata?.requiresConversationHistory
      );

      let ctx = this.context;
      let normalizedHistory: NormalizedConversationEntry[] = [];

      if (needsConversationHistory && conversationHistory !== undefined) {
        normalizedHistory = this.normalizeConversationHistory(conversationHistory);
        if (normalizedHistory.length > 0) {
          ctx = this.createContextWithConversation(normalizedHistory);
        }
      }

      const results: GuardrailResult[] = [];

      const guardrailPromises = compatibleGuardrails.map(async (guardrail) => {
        try {
          const result = await guardrail.run(ctx, text);
          result.info = {
            ...result.info,
            stage_name: stageName,
            guardrail_name: guardrail.definition.name,
            media_type: guardrail.definition.mediaType,
            detected_content_type: detectedContentType,
          };
          return result;
        } catch (error) {
          console.error(`Error running guardrail ${guardrail.definition.name}:`, error);
          return {
            tripwireTriggered: false,
            executionFailed: true,
            originalException: error instanceof Error ? error : new Error(String(error)),
            info: {
              stage_name: stageName,
              guardrail_name: guardrail.definition.name,
              media_type: guardrail.definition.mediaType,
              detected_content_type: detectedContentType,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      });

      const settledResults = await Promise.allSettled(guardrailPromises);

      for (const settledResult of settledResults) {
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
        }
      }

      if (raiseGuardrailErrors) {
        const executionFailures = results.filter((r) => r.executionFailed);
        if (executionFailures.length > 0) {
          throw executionFailures[0].originalException;
        }
      }

      if (!suppressTripwire) {
        for (const result of results) {
          if (result.tripwireTriggered) {
            const { GuardrailTripwireTriggered } = await import('./exceptions');
            throw new GuardrailTripwireTriggered(result);
          }
        }
      }

      return results;
    } catch (error) {
      if (
        !suppressTripwire &&
        error instanceof Error &&
        error.constructor.name === 'GuardrailTripwireTriggered'
      ) {
        throw error;
      }
      throw error;
    }
  }

  protected createContextWithConversation(
    conversationHistory: NormalizedConversationEntry[]
  ): GuardrailLLMContext {
    return {
      guardrailLlm: this.context.guardrailLlm,
      getConversationHistory: () => conversationHistory,
    } as GuardrailLLMContext & {
      getConversationHistory(): NormalizedConversationEntry[];
    };
  }

  protected appendLlmResponseToConversation(
    conversationHistory: NormalizedConversationEntry[] | string | null | undefined,
    llmResponse: OpenAIResponseType
  ): NormalizedConversationEntry[] {
    const normalized =
      conversationHistory !== null && conversationHistory !== undefined
        ? this.normalizeConversationHistory(conversationHistory)
        : [];

    return appendAssistantResponse(normalized, llmResponse);
  }

  public normalizeConversationHistory(payload: unknown): NormalizedConversationEntry[] {
    return normalizeConversation(payload);
  }

  public async loadConversationHistoryFromPreviousResponse(
    previousResponseId?: string | null
  ): Promise<NormalizedConversationEntry[]> {
    if (!previousResponseId || typeof previousResponseId !== 'string' || previousResponseId.trim() === '') {
      return [];
    }

    const items = await this.collectConversationItems(previousResponseId);
    if (!items || items.length === 0) {
      return [];
    }

    return this.normalizeConversationHistory(items);
  }

  private async collectConversationItems(previousResponseId: string): Promise<unknown[]> {
    const items: unknown[] = [];

    const clientRecord = toRecord(this._resourceClient);
    const responsesRecord = getRecord(clientRecord, 'responses');
    const conversationsRecord = getRecord(clientRecord, 'conversations');

    let response: unknown;
    const retrieve = getFunction(responsesRecord, 'retrieve');
    if (retrieve) {
      try {
        response = await retrieve(previousResponseId);
      } catch {
        return items;
      }
    }

    if (!response) {
      return items;
    }

    const responseRecord = toRecord(response);
    const conversation = responseRecord ? toRecord(responseRecord.conversation) : null;
    const conversationIdValue = conversation?.id;
    const conversationId = typeof conversationIdValue === 'string' ? conversationIdValue : null;
    const conversationItems = conversation ? getRecord(conversationsRecord, 'items') : null;
    const listConversationItems = getFunction(conversationItems, 'list');

    if (conversationId && listConversationItems) {
      try {
        const pageResult = await listConversationItems(conversationId, { order: 'asc', limit: 100 });
        if (isAsyncIterable(pageResult)) {
          for await (const entry of pageResult) {
            items.push(entry);
          }
        } else {
          const resultRecord = toRecord(pageResult);
          const data = resultRecord?.data;
          if (Array.isArray(data)) {
            items.push(...data);
          }
        }
      } catch {
        // Ignore and fall back to input items
      }
    }

    if (items.length === 0) {
      const inputItemsRecord = responsesRecord ? getRecord(responsesRecord, 'inputItems') : null;
      const listInputItems = getFunction(inputItemsRecord, 'list');

      if (listInputItems) {
        try {
          const pageResult = await listInputItems(previousResponseId, { order: 'asc', limit: 100 });
          if (isAsyncIterable(pageResult)) {
            for await (const entry of pageResult) {
              if (entry != null) {
                items.push(entry);
              }
            }
          } else {
            const resultRecord = toRecord(pageResult);
            const data = resultRecord?.data;
            if (Array.isArray(data)) {
              items.push(...data.filter((item) => item != null));
            }
          }
        } catch {
          // Ignore, items remain empty
        }
      }

      const outputItems = responseRecord?.output;
      if (Array.isArray(outputItems)) {
        items.push(...outputItems.filter((item) => item != null));
      }
    }

    return items;
  }

  protected async handleLlmResponse<T extends OpenAIResponseType>(
    llmResponse: T,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    conversationHistory?: unknown,
    suppressTripwire: boolean = false
  ): Promise<GuardrailsResponse<T>> {
    const normalizedHistory =
      conversationHistory !== undefined && conversationHistory !== null
        ? this.normalizeConversationHistory(conversationHistory)
        : [];
    const completeConversation = this.appendLlmResponseToConversation(normalizedHistory, llmResponse);

    const responseText = this.extractResponseText(llmResponse);
    const outputResults = await this.runStageGuardrails(
      'output',
      responseText,
      completeConversation,
      suppressTripwire
    );

    return this.createGuardrailsResponse(llmResponse, preflightResults, inputResults, outputResults);
  }
}
