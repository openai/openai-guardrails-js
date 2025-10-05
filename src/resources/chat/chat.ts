/* eslint-disable no-dupe-class-members */
/**
 * Chat completions with guardrails.
 */

import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse } from '../../base-client';

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
      messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      model: string;
      stream: true;
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'messages' | 'model' | 'stream'>
  ): Promise<AsyncIterableIterator<GuardrailsResponse>>;

  // Overload: non-streaming (default)
  create(
    params: {
      messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      model: string;
      stream?: false;
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'messages' | 'model' | 'stream'>
  ): Promise<GuardrailsResponse<OpenAI.Chat.Completions.ChatCompletion>>;

  async create(
    params: {
      messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      model: string;
      stream?: boolean;
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'messages' | 'model' | 'stream'>
  ): Promise<GuardrailsResponse<OpenAI.Chat.Completions.ChatCompletion> | AsyncIterableIterator<GuardrailsResponse>> {
    const { messages, model, stream = false, suppressTripwire = false, ...kwargs } = params;

    const [latestMessage] = this.client.extractLatestUserMessage(messages);

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
      (this.client as any)._resourceClient.chat.completions.create({
        messages: modifiedMessages,
        model,
        stream,
        ...kwargs,
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
