/**
 * Streaming functionality for guardrails integration.
 *
 * This module contains streaming-related logic for handling LLM responses
 * with periodic guardrail checks.
 */

import { GuardrailResult, TextOnlyMessageArray } from './types';
import { GuardrailsResponse, GuardrailsBaseClient, OpenAIResponseType } from './base-client';
import { GuardrailTripwireTriggered } from './exceptions';

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
    conversationHistory?: TextOnlyMessageArray,
    checkInterval: number = 100,
    suppressTripwire: boolean = false
  ): AsyncIterableIterator<GuardrailsResponse> {
    let accumulatedText = '';
    let chunkCount = 0;

    for await (const chunk of llmStream) {
      // Extract text from chunk
      const chunkText = this.extractResponseText(chunk as OpenAIResponseType);
      if (chunkText) {
        accumulatedText += chunkText;
        chunkCount++;

        // Run output guardrails periodically
        if (chunkCount % checkInterval === 0) {
          try {
            await this.runStageGuardrails(
              'output',
              accumulatedText,
              conversationHistory as TextOnlyMessageArray,
              suppressTripwire
            );
          } catch (error) {
            if (error instanceof GuardrailTripwireTriggered) {
              // Create a final response with the error
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

      // Yield the chunk wrapped in GuardrailsResponse
      const response = this.createGuardrailsResponse(
        chunk as OpenAIResponseType,
        preflightResults,
        inputResults,
        [] // No output results yet for streaming chunks
      );
      yield response;
    }

    // Final guardrail check on complete text
    if (!suppressTripwire && accumulatedText) {
      try {
        const finalOutputResults = await this.runStageGuardrails(
          'output',
          accumulatedText,
          conversationHistory as TextOnlyMessageArray,
          suppressTripwire
        );

        // Create a final response with all results
        const finalResponse = this.createGuardrailsResponse(
          { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
          preflightResults,
          inputResults,
          finalOutputResults
        );
        yield finalResponse;
      } catch (error) {
        if (error instanceof GuardrailTripwireTriggered) {
          // Create a final response with the error
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
    conversationHistory?: TextOnlyMessageArray,
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
