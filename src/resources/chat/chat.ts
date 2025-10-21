/**
 * Chat completions with guardrails.
 */

/* eslint-disable no-dupe-class-members */
import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse } from '../../base-client';
import { Message } from '../../types';

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

    // Preflight first
    const preflightResults = await this.client.runStageGuardrails(
      'pre_flight',
      latestMessage,
      messages,
      suppressTripwire,
      this.client.raiseGuardrailErrors
    );

    // Apply pre-flight modifications (PII masking, etc.)
    const modifiedMessages = this.client.applyPreflightModifications(
      messages,
      preflightResults
    );

    // Run input guardrails and LLM call concurrently
    const [inputResults, llmResponse] = await Promise.all([
      this.client.runStageGuardrails(
        'input',
        latestMessage,
        messages,
        suppressTripwire,
        this.client.raiseGuardrailErrors
      ),
      // Access protected _resourceClient - necessary for external resource classes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any)._resourceClient.chat.completions.create({
        messages: modifiedMessages,
        model,
        stream,
        ...kwargs,
        // @ts-ignore - safety_identifier is not defined in OpenAI types yet
        safety_identifier: 'oai-guardrails-ts',
      }),
    ]);

    // Handle streaming vs non-streaming
    if (stream) {
      const { StreamingMixin } = require('../../streaming');
      return StreamingMixin.streamWithGuardrailsSync(
        this.client,
        llmResponse,
        preflightResults,
        inputResults,
        messages,
        suppressTripwire
      );
    } else {
      // Access protected handleLlmResponse - necessary for external resource classes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.client as any).handleLlmResponse(
        llmResponse,
        preflightResults,
        inputResults,
        messages,
        suppressTripwire
      );
    }
  }
}
