/**
 * Streaming functionality for guardrails integration.
 *
 * This module contains streaming-related logic for handling LLM responses
 * with periodic guardrail checks.
 */

import type { GuardrailsBaseClient, GuardrailsResponse, OpenAIResponseType } from './base-client';
import type { GuardrailResult } from './types';
import { mergeConversationWithItems, type NormalizedConversationEntry } from './utils/conversation';
import { getGuardrailFailure } from './utils/guardrail-failure';

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
    let lastStrictCheckedTextLength = 0;
    const baseHistory = conversationHistory
      ? conversationHistory.map((entry) => ({ ...entry }))
      : [];

    for await (const chunk of llmStream) {
      const chunkText = this.extractResponseText(chunk as OpenAIResponseType);
      if (chunkText) {
        accumulatedText += chunkText;
        chunkCount += 1;

        if (chunkCount % checkInterval === 0) {
          const history = mergeConversationWithItems(baseHistory, [
            { role: 'assistant', content: accumulatedText },
          ]);
          // Collect results first: the original execution error may itself be a tripwire error.
          const results = await this.runStageGuardrails(
            'output',
            accumulatedText,
            history,
            true,
            false
          );
          const failure = getGuardrailFailure(results, suppressTripwire, this.raiseGuardrailErrors);
          if (failure) {
            if (failure.kind === 'tripwire') {
              yield this.createGuardrailsResponse(
                chunk as OpenAIResponseType,
                preflightResults,
                inputResults,
                [failure.error.guardrailResult]
              );
            }
            throw failure.error;
          }
          if (this.raiseGuardrailErrors) lastStrictCheckedTextLength = accumulatedText.length;
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

    const needsStrictFinalCheck =
      this.raiseGuardrailErrors && accumulatedText.length > lastStrictCheckedTextLength;
    if ((!suppressTripwire || needsStrictFinalCheck) && accumulatedText) {
      const history = mergeConversationWithItems(baseHistory, [
        { role: 'assistant', content: accumulatedText },
      ]);
      const finalOutputResults = await this.runStageGuardrails(
        'output',
        accumulatedText,
        history,
        true,
        false
      );
      const failure = getGuardrailFailure(
        finalOutputResults,
        suppressTripwire,
        this.raiseGuardrailErrors
      );
      if (failure) {
        if (failure.kind === 'tripwire') {
          yield this.createGuardrailsResponse(
            { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
            preflightResults,
            inputResults,
            [failure.error.guardrailResult]
          );
        }
        throw failure.error;
      }
      if (!suppressTripwire) {
        yield this.createGuardrailsResponse(
          { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
          preflightResults,
          inputResults,
          finalOutputResults
        );
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
