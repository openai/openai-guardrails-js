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
    const choices = new Map<number, { text: string; chunkCount: number }>();
    const baseHistory = conversationHistory ? conversationHistory.map((entry) => ({ ...entry })) : [];

    for await (const chunk of llmStream) {
      const responseChunk = chunk as OpenAIResponseType;
      const alternatives = 'choices' in responseChunk
        ? responseChunk.choices.map((choice) => ({
          index: choice.index ?? 0,
          response: { ...responseChunk, choices: [choice] } as OpenAIResponseType,
        }))
        : [{ index: 0, response: responseChunk }];
      const periodicChecks: Promise<GuardrailResult[]>[] = [];
      for (const alternative of alternatives) {
        const chunkText = this.extractResponseText(alternative.response);
        if (!chunkText) {
          continue;
        }
        const state = choices.get(alternative.index) ?? { text: '', chunkCount: 0 };
        state.text += chunkText;
        state.chunkCount += 1;
        choices.set(alternative.index, state);

        if (state.chunkCount % checkInterval === 0) {
          const history = mergeConversationWithItems(baseHistory, [
            { role: 'assistant', content: state.text },
          ]);
          periodicChecks.push(this.runStageGuardrails('output', state.text, history, suppressTripwire));
        }
      }

      try {
        await Promise.all(periodicChecks);
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

      const response = this.createGuardrailsResponse(
        chunk as OpenAIResponseType,
        preflightResults,
        inputResults,
        []
      );
      yield response;
    }

    if (choices.size > 0) {
      // Keep the existing final response shape; results cover every alternative.
      const accumulatedText = choices.get(0)?.text ?? '';
      const settledChecks = await Promise.allSettled(
        [...choices.entries()].sort(([a], [b]) => a - b).map(([, state]) => {
          const history = mergeConversationWithItems(baseHistory, [
            { role: 'assistant', content: state.text },
          ]);
          return this.runStageGuardrails('output', state.text, history, suppressTripwire);
        })
      );
      const finalOutputResults: GuardrailResult[] = [];
      for (const check of settledChecks) {
        if (check.status === 'fulfilled') {
          finalOutputResults.push(...check.value);
        } else if (check.reason instanceof GuardrailTripwireTriggered) {
          finalOutputResults.push(check.reason.guardrailResult);
        }
      }
      const failure = settledChecks.find((check) => check.status === 'rejected');
      if (failure?.status === 'rejected' && !(failure.reason instanceof GuardrailTripwireTriggered)) {
        throw failure.reason;
      }
      const finalResponse = this.createGuardrailsResponse(
        { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
        preflightResults,
        inputResults,
        finalOutputResults
      );
      yield finalResponse;
      if (failure?.status === 'rejected') {
        throw failure.reason;
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
