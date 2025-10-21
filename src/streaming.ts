/**
 * Streaming functionality for guardrails integration.
 *
 * This module contains streaming-related logic for handling LLM responses
 * with periodic guardrail checks.
 */

import { GuardrailResult } from './types';
import { GuardrailsResponse, GuardrailsBaseClient, OpenAIResponseType } from './base-client';
import { GuardrailTripwireTriggered } from './exceptions';
import { mergeConversationWithItems, NormalizedConversationEntry } from './utils/conversation';

/**
 * Mixin providing streaming functionality for guardrails clients.
 */
export class StreamingMixin {
  /**
   * Stream with periodic guardrail checks (async).
   */
  async *streamWithGuardrails(
    this: GuardrailsBaseClient,
    llmStream: AsyncIterable<unknown>,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    conversationHistory?: NormalizedConversationEntry[],
    checkInterval: number = 100,
    suppressTripwire: boolean = false
  ): AsyncIterableIterator<GuardrailsResponse> {
    let accumulatedText = '';
    let chunkCount = 0;
    const baseHistory = conversationHistory ? conversationHistory.map((entry) => ({ ...entry })) : [];

    for await (const chunk of llmStream) {
      const chunkText = this.extractResponseText(chunk as OpenAIResponseType);
      if (chunkText) {
        accumulatedText += chunkText;
        chunkCount += 1;

        if (chunkCount % checkInterval === 0) {
          try {
            const history = mergeConversationWithItems(baseHistory, [
              { role: 'assistant', content: accumulatedText },
            ]);
            await this.runStageGuardrails('output', accumulatedText, history, suppressTripwire);
          } catch (error) {
            if (error instanceof GuardrailTripwireTriggered) {
              const finalResponse = this.createGuardrailsResponse(
                chunk as OpenAIResponseType,
                preflightResults,
                inputResults,
                [error.guardrailResult]
              );
              yield finalResponse;
              throw error;
            }
            throw error;
          }
        }
      }

      const response = this.createGuardrailsResponse(
        chunk as OpenAIResponseType,
        preflightResults,
        inputResults,
        []
      );
      yield response;
    }

    if (!suppressTripwire && accumulatedText) {
      try {
        const history = mergeConversationWithItems(baseHistory, [
          { role: 'assistant', content: accumulatedText },
        ]);
        const finalOutputResults = await this.runStageGuardrails(
          'output',
          accumulatedText,
          history,
          suppressTripwire
        );

        const finalResponse = this.createGuardrailsResponse(
          { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
          preflightResults,
          inputResults,
          finalOutputResults
        );
        yield finalResponse;
      } catch (error) {
        if (error instanceof GuardrailTripwireTriggered) {
          const finalResponse = this.createGuardrailsResponse(
            { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
            preflightResults,
            inputResults,
            [error.guardrailResult]
          );
          yield finalResponse;
          throw error;
        }
        throw error;
      }
    }
  }

  /**
   * Stream with guardrails (sync wrapper for compatibility).
   */
  static streamWithGuardrailsSync(
    client: GuardrailsBaseClient,
    llmStream: AsyncIterable<unknown>,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    conversationHistory?: NormalizedConversationEntry[],
    suppressTripwire: boolean = false
  ): AsyncIterableIterator<GuardrailsResponse> {
    const streamingMixin = new StreamingMixin();
    return streamingMixin.streamWithGuardrails.call(
      client,
      llmStream,
      preflightResults,
      inputResults,
      conversationHistory,
      100,
      suppressTripwire
    );
  }
}
