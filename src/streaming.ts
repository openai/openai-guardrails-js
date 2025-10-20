/**
 * Streaming functionality for guardrails integration.
 *
 * This module contains streaming-related logic for handling LLM responses
 * with periodic guardrail checks.
 */

import { GuardrailResult } from './types';
import { GuardrailsResponse, GuardrailsBaseClient } from './base-client';
import { GuardrailTripwireTriggered } from './exceptions';
import { mergeConversationWithItems, normalizeConversation } from './utils/conversation';

/**
 * Mixin providing streaming functionality for guardrails clients.
 */
export class StreamingMixin {
  /**
   * Stream with periodic guardrail checks (async).
   */
  async *streamWithGuardrails(
    this: GuardrailsBaseClient,
    llmStream: AsyncIterable<any>,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    conversationHistory?: any[],
    checkInterval: number = 100,
    suppressTripwire: boolean = false
  ): AsyncIterableIterator<GuardrailsResponse> {
    let accumulatedText = '';
    let chunkCount = 0;
    const baseHistory = conversationHistory
      ? normalizeConversation(conversationHistory)
      : [];

    for await (const chunk of llmStream) {
      // Extract text from chunk
      const chunkText = (this as any).extractResponseText(chunk);
      if (chunkText) {
        accumulatedText += chunkText;
        chunkCount++;

        // Run output guardrails periodically
        if (chunkCount % checkInterval === 0) {
          try {
            const history = mergeConversationWithItems(baseHistory, [
              { role: 'assistant', content: accumulatedText },
            ]);
            await (this as any).runStageGuardrails(
              'output',
              accumulatedText,
              history,
              suppressTripwire
            );
          } catch (error) {
            if (error instanceof GuardrailTripwireTriggered) {
              // Create a final response with the error
              const finalResponse = (this as any).createGuardrailsResponse(
                chunk,
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

      // Yield the chunk wrapped in GuardrailsResponse
      const response = (this as any).createGuardrailsResponse(
        chunk,
        preflightResults,
        inputResults,
        [] // No output results yet for streaming chunks
      );
      yield response;
    }

    // Final guardrail check on complete text
    if (!suppressTripwire && accumulatedText) {
      try {
        const history = mergeConversationWithItems(baseHistory, [
          { role: 'assistant', content: accumulatedText },
        ]);
        const finalOutputResults = await (this as any).runStageGuardrails(
          'output',
          accumulatedText,
          history,
          suppressTripwire
        );

        // Create a final response with all results
        const finalResponse = (this as any).createGuardrailsResponse(
          { type: 'final', accumulated_text: accumulatedText },
          preflightResults,
          inputResults,
          finalOutputResults
        );
        yield finalResponse;
      } catch (error) {
        if (error instanceof GuardrailTripwireTriggered) {
          // Create a final response with the error
          const finalResponse = (this as any).createGuardrailsResponse(
            { type: 'final', accumulated_text: accumulatedText },
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
    llmStream: AsyncIterable<any>,
    preflightResults: GuardrailResult[],
    inputResults: GuardrailResult[],
    conversationHistory?: any[],
    suppressTripwire: boolean = false
  ): AsyncIterableIterator<GuardrailsResponse> {
    const streamingMixin = new StreamingMixin();
    return streamingMixin.streamWithGuardrails.call(
      client,
      llmStream,
      preflightResults,
      inputResults,
      conversationHistory ? normalizeConversation(conversationHistory) : undefined,
      100,
      suppressTripwire
    );
  }
}
