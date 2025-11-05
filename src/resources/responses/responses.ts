/**
 * Responses API with guardrails.
 */
/* eslint-disable no-dupe-class-members */
import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse } from '../../base-client';
import { Message } from '../../types';
import { mergeConversationWithItems } from '../../utils/conversation';
import { SAFETY_IDENTIFIER, supportsSafetyIdentifier } from '../../utils/safety-identifier';

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

    const extraOptions = kwargs as Record<string, unknown>;
    const previousResponseIdValue =
      extraOptions['previous_response_id'] ?? extraOptions['previousResponseId'];
    const previousResponseId =
      typeof previousResponseIdValue === 'string' ? previousResponseIdValue : undefined;
    const priorHistory = await this.client.loadConversationHistoryFromPreviousResponse(previousResponseId);
    const currentTurn = this.client.normalizeConversationHistory(input);
    const normalizedConversation =
      priorHistory.length > 0 ? mergeConversationWithItems(priorHistory, currentTurn) : currentTurn;

    // Determine latest user message text when a list of messages is provided
    let latestMessage: string;
    if (Array.isArray(input)) {
      [latestMessage] = this.client.extractLatestUserTextMessage(input);
    } else {
      latestMessage = input;
    }

    // Preflight first (run checks on the latest user message text, with full conversation)
    const preflightResults = await this.client.runStageGuardrails(
      'pre_flight',
      latestMessage,
      normalizedConversation,
      suppressTripwire,
      this.client.raiseGuardrailErrors
    );

    // Apply pre-flight modifications (PII masking, etc.)
    const modifiedInput = this.client.applyPreflightModifications(
      input, 
      preflightResults
    );

    // Input guardrails and LLM call concurrently
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resourceClient = (this.client as any)._resourceClient;
    
    // Build API call parameters
    const apiParams: Record<string, unknown> = {
      input: modifiedInput,
      model,
      stream,
      tools,
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
      resourceClient.responses.create(apiParams),
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
