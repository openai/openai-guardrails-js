/**
 * Chat completions with guardrails.
 */

/* eslint-disable no-dupe-class-members */
import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse } from '../../base-client';
import { Message } from '../../types';
import { SAFETY_IDENTIFIER, supportsSafetyIdentifier } from '../../utils/safety-identifier';

// Note: We need to filter out non-text content since guardrails only work with text
// The existing extractLatestUserTextMessage method expects TextOnlyMessageArray

/**
 * Chat completions with guardrails.
 */
export class Chat {
  constructor(private client: GuardrailsBaseClient) { }

  get completions(): ChatCompletions {
    return new ChatCompletions(this.client);
  }
}

/**
 * Chat completions interface with guardrails.
 */
export class ChatCompletions {
  constructor(private client: GuardrailsBaseClient) { }

  /**
   * Create chat completion with guardrails.
   * 
   * Runs preflight first, then executes input guardrails concurrently with the LLM call.
   */
  // Overload: streaming
  create(
    params: {
      messages: Message[];
      model: string;
      stream: true;
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'messages' | 'model' | 'stream'>
  ): Promise<AsyncIterableIterator<GuardrailsResponse>>;

  // Overload: non-streaming (default)
  create(
    params: {
      messages: Message[];
      model: string;
      stream?: false;
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'messages' | 'model' | 'stream'>
  ): Promise<GuardrailsResponse<OpenAI.Chat.Completions.ChatCompletion>>;

  async create(
    params: {
      messages: Message[];
      model: string;
      stream?: boolean;
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'messages' | 'model' | 'stream'>
  ): Promise<GuardrailsResponse<OpenAI.Chat.Completions.ChatCompletion> | AsyncIterableIterator<GuardrailsResponse>> {
    const { messages, model, stream = false, suppressTripwire = false, ...kwargs } = params;

    // Extract latest user message text for guardrails (guardrails only work with text content)
    const [latestMessage] = this.client.extractLatestUserTextMessage(messages);
    const normalizedConversation = this.client.normalizeConversationHistory(messages);

    // Preflight first
    const preflightResults = await this.client.runStageGuardrails(
      'pre_flight',
      latestMessage,
      normalizedConversation,
      suppressTripwire,
      this.client.raiseGuardrailErrors
    );

    // Apply pre-flight modifications (PII masking, etc.)
    const modifiedMessages = this.client.applyPreflightModifications(
      messages,
      preflightResults
    );

    // Run input guardrails and LLM call concurrently
    // Access protected _resourceClient - necessary for external resource classes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resourceClient = (this.client as any)._resourceClient;
    
    // Build API call parameters
    const apiParams: Record<string, unknown> = {
      messages: modifiedMessages,
      model,
      stream,
      ...kwargs,
    };
    
    // Only include safety_identifier for official OpenAI API (not Azure or local providers)
    if (supportsSafetyIdentifier(resourceClient)) {
      // @ts-ignore - safety_identifier is not defined in OpenAI types yet
      apiParams.safety_identifier = SAFETY_IDENTIFIER;
    }
    
    const [inputResults, llmResponse] = await Promise.all([
      this.client.runStageGuardrails(
        'input',
        latestMessage,
        normalizedConversation,
        suppressTripwire,
        this.client.raiseGuardrailErrors
      ),
      resourceClient.chat.completions.create(apiParams),
    ]);

    // Handle streaming vs non-streaming
    if (stream) {
      const { StreamingMixin } = require('../../streaming');
      return StreamingMixin.streamWithGuardrailsSync(
        this.client,
        llmResponse,
        preflightResults,
        inputResults,
        normalizedConversation,
        suppressTripwire
      );
    } else {
      // Access protected handleLlmResponse - necessary for external resource classes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.client as any).handleLlmResponse(
        llmResponse,
        preflightResults,
        inputResults,
        normalizedConversation,
        suppressTripwire
      );
    }
  }
}
