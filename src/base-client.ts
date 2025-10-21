/**
 * Base client functionality for guardrails integration.
 *
 * This module contains the shared base class and data structures used by both
 * async and sync guardrails clients.
 */

import { OpenAI, AzureOpenAI } from 'openai';
import { GuardrailResult, GuardrailLLMContext, TextOnlyMessageArray, TextOnlyContent, Message, ContentPart, TextContentPart } from './types';
import { ContentUtils } from './utils/content';
import {
  GuardrailBundle,
  ConfiguredGuardrail,
  instantiateGuardrails,
} from './runtime';

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
  public raiseGuardrailErrors: boolean = false;

  /**
   * Extract the latest user text message from a conversation for text guardrails.
   *
   * This method specifically extracts text content from messages. For other content types,
   * create parallel methods like extractLatestUserImage() or extractLatestUserVideo().
   *
   * @param messages List of messages (can include non-text content)
   * @returns Tuple of [message_text, message_index]. Index is -1 if no user message found.
   */
  public extractLatestUserTextMessage(messages: Message[]): [string, number] {
    const textOnlyMessages = ContentUtils.filterToTextOnly(messages);
    
    for (let i = textOnlyMessages.length - 1; i >= 0; i--) {
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
    data: Message[] | string,
    preflightResults: GuardrailResult[]
  ): Message[] | string {
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
      const [, latestUserIdx] = this.extractLatestUserTextMessage(data);
      if (latestUserIdx === -1) {
        return data;
      }

      // Use shallow copy for efficiency - we only modify the content field of one message
      const modifiedMessages = [...data];
      const currentContent = data[latestUserIdx].content;

      // Apply modifications based on content type
      let modifiedContent: string | ContentPart[];
      if (typeof currentContent === 'string') {
        // Plain string content - mask individually
        modifiedContent = maskText(currentContent);
      } else if (Array.isArray(currentContent)) {
        // Structured content - mask each text part individually
        modifiedContent = currentContent.map(part => {
          if (ContentUtils.isText(part)) {
            const textPart = part as TextContentPart;
            return { ...textPart, text: maskText(textPart.text) };
          }
          return part; // Keep non-text parts unchanged
        });
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
  protected extractResponseText(response: OpenAIResponseType): string {
    // Handle Response type (no choices property)
    if ('output' in response) {
      return response.output_text || '';
    }
    
    // Handle other response types with choices
    if ('choices' in response && response.choices) {
      const choice0 = response.choices[0];
      
      // Handle ChatCompletion
      if ('message' in choice0 && choice0.message) {
        return choice0.message.content || '';
      }
      
      // Handle Completion
      if ('text' in choice0 && choice0.text) {
        return choice0.text;
      }
      
      // Handle streaming responses (ChatCompletionChunk)
      if ('delta' in choice0 && choice0.delta) {
        return choice0.delta.content || '';
      }
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
    clientClass: typeof OpenAI | typeof AzureOpenAI
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
   * Determine if a guardrail should run based on content type compatibility.
   * 
   * Currently only supports text/plain content type matching.
   * 
   * @future To extend for multi-modal support:
   * - Add image/*, audio/*, video/* pattern matching
   * - Implement content type hierarchy (image/* matches image/jpeg, etc.)
   * - Add wildcard support for broader compatibility
   */
  private shouldRunGuardrail(guardrail: ConfiguredGuardrail, detectedContentType: string): boolean {
    return guardrail.definition.mediaType === detectedContentType;
  }


  /**
   * Run guardrails for a specific pipeline stage.
   */
  public async runStageGuardrails(
    stageName: 'pre_flight' | 'input' | 'output',
    text: string,
    conversationHistory?: Message[],
    suppressTripwire: boolean = false,
    raiseGuardrailErrors: boolean = false
  ): Promise<GuardrailResult[]> {
    if (this.guardrails[stageName].length === 0) {
      return [];
    }

    try {
      // Content type detection - currently text-only
      // @future: Add content analysis for multi-modal support (images, audio, video)
      const detectedContentType = 'text/plain';
      
      // Filter guardrails based on content type compatibility
      const compatibleGuardrails = this.guardrails[stageName].filter(guardrail => 
        this.shouldRunGuardrail(guardrail, detectedContentType)
      );

      const skippedGuardrails = this.guardrails[stageName].filter(guardrail => 
        !this.shouldRunGuardrail(guardrail, detectedContentType)
      );

      // Log warnings for skipped guardrails
      if (skippedGuardrails.length > 0) {
        console.warn(
          `⚠️  Guardrails Warning: ${skippedGuardrails.length} guardrails skipped due to content type mismatch ` +
          `(detected: ${detectedContentType}). Skipped: ${skippedGuardrails.map(g => g.definition.name).join(', ')}`
        );
      }

      if (compatibleGuardrails.length === 0) {
        console.warn(`No guardrails compatible with content type '${detectedContentType}' for stage '${stageName}'`);
        return [];
      }

      // Check if any guardrail requires conversation history and we have it available
      const needsConversationHistory = compatibleGuardrails.some(
        (guardrail) => guardrail.definition.metadata?.requiresConversationHistory
      );

      let ctx = this.context;
      if (needsConversationHistory && conversationHistory) {
        // Filter to text-only for conversation history processing
        const textOnlyHistory = ContentUtils.filterToTextOnly(conversationHistory);
        ctx = this.createContextWithConversation(textOnlyHistory);
      }

      const results: GuardrailResult[] = [];

      // Run compatible guardrails in parallel using Promise.allSettled to capture all results
      const guardrailPromises = compatibleGuardrails.map(async (guardrail) => {
        try {
          const result = await guardrail.run(ctx, text);
          // Add stage and guardrail metadata
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
          // Return a failed result instead of throwing
          return {
            tripwireTriggered: false,
            executionFailed: true,
            originalException: error instanceof Error ? error : new Error(String(error)),
            info: {
              checked_text: text, // Return original text on error
              stage_name: stageName,
              guardrail_name: guardrail.definition.name,
              media_type: guardrail.definition.mediaType,
              detected_content_type: detectedContentType,
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
   * Create a context with conversation history for guardrails that require it.
   * 
   * @future To extend for multi-modal support:
   * - Add support for image/audio content in conversation history
   * - Implement content type filtering based on guardrail requirements
   * - Add metadata about content types in the context
   */
  protected createContextWithConversation(conversationHistory: TextOnlyMessageArray): GuardrailLLMContext {
    // Create a new context that includes conversation history and tracking metadata
    return {
      guardrailLlm: this.context.guardrailLlm,
      // Add conversation history methods
      getConversationHistory: () => conversationHistory,
    } as GuardrailLLMContext & {
      getConversationHistory(): TextOnlyMessageArray;
    };
  }

  /**
   * Append LLM response to conversation history.
   */
  protected appendLlmResponseToConversation(
    conversationHistory: TextOnlyMessageArray | string | null,
    llmResponse: OpenAIResponseType
  ): TextOnlyMessageArray {
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
    if ('output' in llmResponse && llmResponse.output && Array.isArray(llmResponse.output)) {
      // Convert ResponseOutputItem to TextOnlyMessage format
      const convertedOutput = llmResponse.output
        .filter(item => 'role' in item && 'content' in item)
        .map(item => {
          const itemWithRole = item as { role: string; content: unknown };
          return {
            role: itemWithRole.role,
            content: itemWithRole.content as TextOnlyContent
          };
        });
      updatedHistory.push(...convertedOutput);
    }
    // For chat completions: append the choice message directly (prompt injection detection check will parse)
    else if (
      'choices' in llmResponse &&
      llmResponse.choices &&
      Array.isArray(llmResponse.choices) &&
      llmResponse.choices.length > 0 &&
      'message' in llmResponse.choices[0] &&
      llmResponse.choices[0].message &&
      llmResponse.choices[0].message.content
    ) {
      const message = llmResponse.choices[0].message;
      if (message.content) {
        updatedHistory.push({
          role: message.role,
          content: message.content
        });
      }
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
    conversationHistory?: TextOnlyMessageArray,
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
