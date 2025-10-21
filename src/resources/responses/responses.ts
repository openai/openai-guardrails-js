/**
 * Responses API with guardrails.
 */
/* eslint-disable no-dupe-class-members */
import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse } from '../../base-client';
import { Message } from '../../types';

/**
 * Responses API with guardrails.
 */
export class Responses {
  constructor(private client: GuardrailsBaseClient) { }

  /**
   * Create response with guardrails.
   * 
   * Runs preflight first, then executes input guardrails concurrently with the LLM call.
   */
  // Overload: streaming
  create(
    params: {
      input: string | Message[];
      model: string;
      stream: true;
      tools?: unknown[];
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Responses.ResponseCreateParams, 'input' | 'model' | 'stream' | 'tools'>
  ): Promise<AsyncIterableIterator<GuardrailsResponse>>;

  // Overload: non-streaming (default)
  create(
    params: {
      input: string | Message[];
      model: string;
      stream?: false;
      tools?: unknown[];
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Responses.ResponseCreateParams, 'input' | 'model' | 'stream' | 'tools'>
  ): Promise<GuardrailsResponse<OpenAI.Responses.Response>>;

  async create(
    params: {
      input: string | Message[];
      model: string;
      stream?: boolean;
      tools?: unknown[];
      suppressTripwire?: boolean;
    } & Omit<OpenAI.Responses.ResponseCreateParams, 'input' | 'model' | 'stream' | 'tools'>
  ): Promise<GuardrailsResponse<OpenAI.Responses.Response> | AsyncIterableIterator<GuardrailsResponse>> {
    const { input, model, stream = false, tools, suppressTripwire = false, ...kwargs } = params;

    // Determine latest user message text when a list of messages is provided
    let latestMessage: string;
    if (Array.isArray(input)) {
      [latestMessage] = this.client.extractLatestUserTextMessage(input);
    } else {
      latestMessage = input;
    }

    // Extract conversation history for guardrail processing
    const conversationHistory = Array.isArray(input) ? input : undefined;

    // Preflight first (run checks on the latest user message text, with full conversation)
    const preflightResults = await this.client.runStageGuardrails(
      'pre_flight',
      latestMessage,
      conversationHistory,
      suppressTripwire,
      this.client.raiseGuardrailErrors
    );

    // Apply pre-flight modifications (PII masking, etc.)
    const modifiedInput = this.client.applyPreflightModifications(
      input, 
      preflightResults
    );

    // Input guardrails and LLM call concurrently
    const [inputResults, llmResponse] = await Promise.all([
      this.client.runStageGuardrails(
        'input',
        latestMessage,
        conversationHistory,
        suppressTripwire,
        this.client.raiseGuardrailErrors
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any)._resourceClient.responses.create({
        input: modifiedInput,
        model,
        stream,
        tools,
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
        input,
        suppressTripwire
      );
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.client as any).handleLlmResponse(
        llmResponse,
        preflightResults,
        inputResults,
        input,
        suppressTripwire
      );
    }
  }
}
