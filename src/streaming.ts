/**
 * Streaming functionality for guardrails integration.
 *
 * This module contains streaming-related logic for handling LLM responses
 * with periodic guardrail checks.
 */

import { GuardrailResult } from './types';
import { GuardrailsResponse, GuardrailsBaseClient, OpenAIResponseType } from './base-client';
import { getGuardrailFailure } from './utils/guardrail-failure';
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
    const choices = new Map<number, { text: string; chunkCount: number; lastStrictCheckedTextLength: number }>();
    let hasMultipleChoices = false;
    const baseHistory = conversationHistory ? conversationHistory.map((entry) => ({ ...entry })) : [];

    for await (const chunk of llmStream) {
      const responseChunk = chunk as OpenAIResponseType;
      const alternatives = 'choices' in responseChunk
        ? responseChunk.choices.map((choice) => ({
          index: choice.index ?? 0,
          response: { ...responseChunk, choices: [choice] } as OpenAIResponseType,
        }))
        : [{ index: 0, response: responseChunk }];
      if (alternatives.length > 1 || alternatives.some(({ index }) => index !== 0)) {
        hasMultipleChoices = true;
      }
      const periodicChecks: Promise<GuardrailResult[]>[] = [];
      for (const alternative of alternatives) {
        const chunkText = this.extractResponseText(alternative.response);
        if (!chunkText) {
          continue;
        }
        const state = choices.get(alternative.index) ?? { text: '', chunkCount: 0, lastStrictCheckedTextLength: 0 };
        state.text += chunkText;
        state.chunkCount += 1;
        choices.set(alternative.index, state);

        if (state.chunkCount % checkInterval === 0) {
          const history = mergeConversationWithItems(baseHistory, [
            { role: 'assistant', content: state.text },
          ]);
          const checkedLength = state.text.length;
          const strict = this.raiseGuardrailErrors;
          periodicChecks.push(this.runStageGuardrails('output', state.text, history, true, false).then((results) => {
            if (strict) state.lastStrictCheckedTextLength = checkedLength;
            return results;
          }));
        }
      }

      const periodicResults = (await Promise.all(periodicChecks)).flat();
      const periodicFailure = getGuardrailFailure(periodicResults, suppressTripwire, this.raiseGuardrailErrors);
      if (periodicFailure) {
        if (periodicFailure.kind === 'tripwire') {
          yield this.createGuardrailsResponse(
            chunk as OpenAIResponseType, preflightResults, inputResults,
            [periodicFailure.error.guardrailResult]
          );
        }
        throw periodicFailure.error;
      }

      const response = this.createGuardrailsResponse(
        chunk as OpenAIResponseType,
        preflightResults,
        inputResults,
        []
      );
      yield response;
    }

    const finalChoices = [...choices.entries()].sort(([a], [b]) => a - b).filter(([, state]) =>
      hasMultipleChoices || !suppressTripwire ||
      (this.raiseGuardrailErrors && state.text.length > state.lastStrictCheckedTextLength)
    );
    if (finalChoices.length > 0) {
      const accumulatedText = choices.get(0)?.text ?? '';
      const finalOutputResults = (await Promise.all(finalChoices.map(([, state]) => {
        const history = mergeConversationWithItems(baseHistory, [
          { role: 'assistant', content: state.text },
        ]);
        // Classify results before throwing: execution errors can themselves be tripwire errors.
        return this.runStageGuardrails('output', state.text, history, true, false);
      }))).flat();
      const failure = getGuardrailFailure(finalOutputResults, suppressTripwire, this.raiseGuardrailErrors);
      if (failure?.kind === 'execution') throw failure.error;
      if (hasMultipleChoices || !suppressTripwire) {
        yield this.createGuardrailsResponse(
          { type: 'final', accumulated_text: accumulatedText } as unknown as OpenAIResponseType,
          preflightResults, inputResults, finalOutputResults
        );
      }
      if (failure) throw failure.error;
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
