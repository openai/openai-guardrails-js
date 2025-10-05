/**
 * Base client functionality for guardrails integration.
 *
 * This module contains the shared base class and data structures used by both
 * async and sync guardrails clients.
 */

import { OpenAI } from 'openai';
import { GuardrailResult, GuardrailLLMContext } from './types';
import {
  loadConfigBundle,
  runGuardrails,
  instantiateGuardrails,
  GuardrailBundle,
  ConfiguredGuardrail,
} from './runtime';
import { defaultSpecRegistry } from './registry';

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
  ) { }

  /**
   * Get all guardrail results combined.
   */
  get allResults(): GuardrailResult[] {
    return [...this.preflight, ...this.input, ...this.output];
  }

  /**
   * Check if any guardrails triggered tripwires.
   */
  get tripwiresTriggered(): boolean {
    return this.allResults.some((r) => r.tripwireTriggered);
  }

  /**
   * Get only the guardrail results that triggered tripwires.
   */
  get triggeredResults(): GuardrailResult[] {
    return this.allResults.filter((r) => r.tripwireTriggered);
  }
}

/**
 * Wrapper around any OpenAI response with guardrail results.
 *
 * This class provides the same interface as OpenAI responses, with additional
 * guardrail results accessible via the guardrail_results attribute.
 *
 * Users should access content the same way as with OpenAI responses:
 * - For chat completions: response.choices[0].message.content
 * - For responses: response.output_text
 * - For streaming: response.choices[0].delta.content
 */
export type GuardrailsResponse<T extends OpenAIResponseType = OpenAIResponseType> = T & {
  guardrail_results: GuardrailResults;
}

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
  protected _injectionLastCheckedIndex: number = 0;
  public raiseGuardrailErrors: boolean = false;

  /**
   * Extract the latest user message text and its index from a list of message-like items.
   *
   * Supports both dict-based messages (OpenAI) and object models with
   * role/content attributes. Handles Responses API content-part format.
   *
   * @param messages List of messages
   * @returns Tuple of [message_text, message_index]. Index is -1 if no user message found.
   */
  public extractLatestUserMessage(messages: any[]): [string, number] {
    const getAttr = (obj: any, key: string): any => {
      if (typeof obj === 'object' && obj !== null) {
        return obj[key];
      }
      return undefined;
    };

    const contentToText = (content: any): string => {
      // String content
      if (typeof content === 'string') {
        return content.trim();
      }
      // List of content parts (Responses API)
      if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const part of content) {
          if (typeof part === 'object' && part !== null) {
            const partType = part.type;
            const textVal = part.text || '';
            if (
              ['input_text', 'text', 'output_text', 'summary_text'].includes(partType) &&
              typeof textVal === 'string'
            ) {
              parts.push(textVal);
            }
          }
        }
        return parts.join(' ').trim();
      }
      return '';
    };

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const role = getAttr(message, 'role');
      if (role === 'user') {
        const content = getAttr(message, 'content');
        const messageText = contentToText(content);
        return [messageText, i];
      }
    }

    return ['', -1];
  }

  /**
   * Create a GuardrailsResponse with organized results.
   */
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

  /**
   * Setup guardrail infrastructure.
   */
  protected async setupGuardrails(
    config: string | PipelineConfig,
    context?: GuardrailLLMContext
  ): Promise<void> {
    this.pipeline = await this.loadPipelineBundles(config);
    this.guardrails = await this.instantiateAllGuardrails();
    this.context = context || this.createDefaultContext();
    this.validateContext(this.context);
  }

  /**
   * Apply pre-flight modifications to messages or text.
   *
   * @param data Either a list of messages or a text string
   * @param preflightResults Results from pre-flight guardrails
   * @returns Modified data with pre-flight changes applied
   */
  public applyPreflightModifications(
    data: any[] | string,
    preflightResults: GuardrailResult[]
  ): any[] | string {
    if (preflightResults.length === 0) {
      return data;
    }

    // Get PII mappings from preflight results for individual text processing
    const piiMappings: Record<string, string> = {};
    for (const result of preflightResults) {
      if (result.info && 'detected_entities' in result.info) {
        const detected = result.info.detected_entities as Record<string, string[]>;
        for (const [entityType, entities] of Object.entries(detected)) {
          for (const entity of entities) {
            // Map original PII to masked token
            piiMappings[entity] = `<${entityType}>`;
          }
        }
      }
    }

    if (Object.keys(piiMappings).length === 0) {
      return data;
    }

    const maskText = (text: string): string => {
      if (typeof text !== 'string') {
        return text;
      }

      let maskedText = text;

      // Sort PII entities by length (longest first) to avoid partial replacements
      // This ensures longer matches are processed before shorter ones
      const sortedPii = Object.entries(piiMappings).sort((a, b) => b[0].length - a[0].length);

      for (const [originalPii, maskedToken] of sortedPii) {
        if (maskedText.includes(originalPii)) {
          // Use split/join instead of regex to avoid regex injection
          // This treats all characters literally and is safe from special characters
          maskedText = maskedText.split(originalPii).join(maskedToken);
        }
      }

      return maskedText;
    };

    if (typeof data === 'string') {
      // Handle string input (for responses API)
      return maskText(data);
    } else {
      // Handle message list input (primarily for chat API and structured Responses API)
      const [, latestUserIdx] = this.extractLatestUserMessage(data);
      if (latestUserIdx === -1) {
        return data;
      }

      // Use shallow copy for efficiency - we only modify the content field of one message
      const modifiedMessages = [...data];

      // Extract current content safely
      const currentContent = data[latestUserIdx]?.content;

      // Apply modifications based on content type
      let modifiedContent: any;
      if (typeof currentContent === 'string') {
        // Plain string content - mask individually
        modifiedContent = maskText(currentContent);
      } else if (Array.isArray(currentContent)) {
        // Structured content - mask each text part individually
        modifiedContent = [];
        for (const part of currentContent) {
          if (typeof part === 'object' && part !== null) {
            const partType = part.type;
            if (
              ['input_text', 'text', 'output_text', 'summary_text'].includes(partType) &&
              'text' in part
            ) {
              // Mask this specific text part individually
              const originalText = part.text;
              const maskedText = maskText(originalText);
              modifiedContent.push({ ...part, text: maskedText });
            } else {
              // Keep non-text parts unchanged
              modifiedContent.push(part);
            }
          } else {
            // Keep unknown parts unchanged
            modifiedContent.push(part);
          }
        }
      } else {
        // Unknown content type - skip modifications
        return data;
      }

      // Only modify the specific message that needs content changes
      if (modifiedContent !== currentContent) {
        modifiedMessages[latestUserIdx] = {
          ...modifiedMessages[latestUserIdx],
          content: modifiedContent,
        };
      }

      return modifiedMessages;
    }
  }

  /**
   * Instantiate guardrails for all stages.
   */
  protected async instantiateAllGuardrails(): Promise<StageGuardrails> {
    const guardrails: StageGuardrails = {
      pre_flight: [],
      input: [],
      output: [],
    };

    for (const stageName of ['pre_flight', 'input', 'output'] as const) {
      const stage = this.pipeline[stageName];
      if (stage) {
        guardrails[stageName] = await instantiateGuardrails(stage);
      } else {
        guardrails[stageName] = [];
      }
    }

    return guardrails;
  }

  /**
   * Validate context against all guardrails.
   */
  protected validateContext(context: GuardrailLLMContext): void {
    // Implementation would validate that context meets requirements for all guardrails
    // For now, we just check that it has the required guardrailLlm property
    if (!context.guardrailLlm) {
      throw new Error('Context must have a guardrailLlm property');
    }
  }

  /**
   * Extract text content from various response types.
   */
  protected extractResponseText(response: any): string {
    const choice0 = response.choices?.[0];
    const candidates = [
      choice0?.delta?.content,
      choice0?.message?.content,
      response.output_text,
      response.delta,
    ];

    for (const value of candidates) {
      if (typeof value === 'string') {
        return value || '';
      }
    }

    if (response.type === 'response.output_text.delta') {
      return response.delta || '';
    }

    return '';
  }

  /**
   * Load pipeline configuration from string or object.
   */
  protected async loadPipelineBundles(config: string | PipelineConfig): Promise<PipelineConfig> {
    // Use the enhanced loadPipelineBundles from runtime.ts
    const { loadPipelineBundles } = await import('./runtime.js');
    return await loadPipelineBundles(config);
  }

  /**
   * Create default context with guardrail_llm client.
   *
   * This method should be overridden by subclasses to provide the correct type.
   */
  protected abstract createDefaultContext(): GuardrailLLMContext;

  /**
   * Initialize client with common setup.
   *
   * @param config Pipeline configuration
   * @param openaiArgs OpenAI client arguments
   * @param clientClass The OpenAI client class to instantiate for resources
   */
  public async initializeClient(
    config: string | PipelineConfig,
    openaiArgs: ConstructorParameters<typeof OpenAI>[0],
    clientClass: typeof OpenAI | any
  ): Promise<void> {
    // Create a separate OpenAI client instance for resource access
    // This avoids circular reference issues when overriding OpenAI's resource properties
    this._resourceClient = new clientClass(openaiArgs);

    // Setup guardrails after OpenAI initialization
    await this.setupGuardrails(config);

    // Override chat and responses after parent initialization
    this.overrideResources();
  }

  /**
   * Override chat and responses with our guardrail-enhanced versions.
   * Must be implemented by subclasses.
   */
  protected abstract overrideResources(): void;

  /**
   * Run guardrails for a specific pipeline stage.
   */
  public async runStageGuardrails(
    stageName: 'pre_flight' | 'input' | 'output',
    text: string,
    conversationHistory?: any[],
    suppressTripwire: boolean = false,
    raiseGuardrailErrors: boolean = false
  ): Promise<GuardrailResult[]> {
    if (this.guardrails[stageName].length === 0) {
      return [];
    }

    try {
      // Check if prompt injection detection guardrail is present and we have conversation history
      const hasInjectionDetection = this.guardrails[stageName].some(
        (guardrail) => guardrail.definition.name.toLowerCase() === 'prompt injection detection'
      );

      let ctx = this.context;
      if (hasInjectionDetection && conversationHistory) {
        ctx = this.createContextWithConversation(conversationHistory);
      }

      const results: GuardrailResult[] = [];

      // Run guardrails in parallel using Promise.allSettled to capture all results
      const guardrailPromises = this.guardrails[stageName].map(async (guardrail) => {
        try {
          const result = await guardrail.run(ctx, text);
          // Add stage and guardrail metadata
          result.info = {
            ...result.info,
            stage_name: stageName,
            guardrail_name: guardrail.definition.name,
          };
          return result;
        } catch (error) {
          console.error(`Error running guardrail ${guardrail.definition.name}:`, error);
          // Return a failed result instead of throwing
          return {
            tripwireTriggered: false,
            executionFailed: true,
            originalException: error instanceof Error ? error : new Error(String(error)),
            info: {
              checked_text: text, // Return original text on error
              stage_name: stageName,
              guardrail_name: guardrail.definition.name,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      });

      // Wait for all guardrails to complete
      const settledResults = await Promise.allSettled(guardrailPromises);

      // Extract successful results
      for (const settledResult of settledResults) {
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
        }
      }

      // Check for guardrail execution failures and re-raise if configured
      if (raiseGuardrailErrors) {
        const executionFailures = results.filter((r) => r.executionFailed);

        if (executionFailures.length > 0) {
          // Re-raise the first execution failure
          console.debug('Re-raising guardrail execution error due to raiseGuardrailErrors=true');
          throw executionFailures[0].originalException;
        }
      }

      // Check for tripwire triggers unless suppressed
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

  /**
   * Create a context with conversation history for prompt injection detection guardrail.
   */
  protected createContextWithConversation(conversationHistory: any[]): GuardrailLLMContext {
    // Create a new context that includes conversation history and prompt injection detection tracking
    return {
      guardrailLlm: this.context.guardrailLlm,
      // Add conversation history methods
      getConversationHistory: () => conversationHistory,
      getInjectionLastCheckedIndex: () => this._injectionLastCheckedIndex,
      updateInjectionLastCheckedIndex: (newIndex: number) => {
        this._injectionLastCheckedIndex = newIndex;
      },
    } as GuardrailLLMContext & {
      getConversationHistory(): any[];
      getInjectionLastCheckedIndex(): number;
      updateInjectionLastCheckedIndex(index: number): void;
    };
  }

  /**
   * Append LLM response to conversation history.
   */
  protected appendLlmResponseToConversation(
    conversationHistory: any[] | string | null,
    llmResponse: any
  ): any[] {
    if (!conversationHistory) {
      conversationHistory = [];
    }

    // Handle case where conversation_history is a string (from single input)
    if (typeof conversationHistory === 'string') {
      conversationHistory = [{ role: 'user', content: conversationHistory }];
    }

    // Make a copy to avoid modifying the original
    const updatedHistory = [...conversationHistory];

    // For responses API: append the output directly
    if (llmResponse.output && Array.isArray(llmResponse.output)) {
      updatedHistory.push(...llmResponse.output);
    }
    // For chat completions: append the choice message directly (prompt injection detection check will parse)
    else if (
      llmResponse.choices &&
      Array.isArray(llmResponse.choices) &&
      llmResponse.choices.length > 0
    ) {
      updatedHistory.push(llmResponse.choices[0].message);
    }

    return updatedHistory;
  }

  /**
   * Handle non-streaming LLM response with output guardrails.
   */
  protected async handleLlmResponse<T extends OpenAIResponseType>(
    llmResponse: T,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    conversationHistory?: any[],
    suppressTripwire: boolean = false
  ): Promise<GuardrailsResponse<T>> {
    // Create complete conversation history including the LLM response
    const completeConversation = this.appendLlmResponseToConversation(
      conversationHistory || null,
      llmResponse
    );

    const responseText = this.extractResponseText(llmResponse);
    const outputResults = await this.runStageGuardrails(
      'output',
      responseText,
      completeConversation,
      suppressTripwire
    );

    return this.createGuardrailsResponse(
      llmResponse,
      preflightResults,
      inputResults,
      outputResults
    );
  }
}
